"""Server HTTP locale.

Fa solo quello che il sito statico non puo' fare da solo:

  - serve l'interfaccia (web/) e i dati esportati (data/export/);
  - avvia l'aggiornamento del database e ne riporta l'avanzamento;
  - fa da proxy con cache per le immagini delle carte.

Ricerca, filtri, sorteggio e generazione del .ydk **non** stanno qui: sono
in web/store.js, condiviso con la versione su GitHub Pages. Averli in un
posto solo e' cio' che tiene allineate le due versioni.
"""
import json
import mimetypes
import os
import posixpath
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import db, export, sources, updater

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
EXPORT_DIR = os.path.join(ROOT, "data", "export")
IMG_CACHE = os.path.join(ROOT, "data", "imgcache")


class Handler(BaseHTTPRequestHandler):
    server_version = "YuGiOhDeckBuilder"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ risposte

    def _send(self, code, body, content_type, extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, code=200):
        self._send(
            code,
            json.dumps(payload, ensure_ascii=False),
            "application/json; charset=utf-8",
            {"Cache-Control": "no-store"},
        )

    def _error(self, code, message):
        self._json({"error": message}, code)

    def log_message(self, fmt, *args):
        if os.environ.get("YGO_VERBOSE"):
            super().log_message(fmt, *args)

    # -------------------------------------------------------------- routing

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if path.startswith("/api/"):
                return self._route_api(path, query)
            return self._serve_static(path)
        except BrokenPipeError:
            pass
        except Exception as exc:
            self._error(500, "%s: %s" % (type(exc).__name__, exc))

    do_HEAD = do_GET

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            body = {}

        try:
            if path == "/api/update":
                return self._start_update(body)
            return self._error(404, "Endpoint non trovato: %s" % path)
        except Exception as exc:
            self._error(500, "%s: %s" % (type(exc).__name__, exc))

    # ------------------------------------------------------------------ API

    def _route_api(self, path, query):
        # L'interfaccia interroga questo per capire se e' in locale o su
        # GitHub Pages, dove la richiesta fallisce e i tasti di
        # aggiornamento restano nascosti.
        if path == "/api/capabilities":
            return self._json({"update": True, "imageProxy": True})
        if path == "/api/update":
            return self._json(updater.status())
        if path == "/api/formats":
            return self._json({"available": sources.FORMATS})
        if path.startswith("/api/img/"):
            return self._image(path, query)
        return self._error(404, "Endpoint non trovato: %s" % path)

    def _one(self, query, key, default=""):
        values = query.get(key) or []
        return values[0].strip() if values else default

    def _image(self, path, query):
        """Proxy con cache su disco: il mazzo si riapre anche senza rete."""
        raw_id = path[len("/api/img/"):].strip("/")
        if not raw_id.isdigit():
            return self._error(400, "Passcode non valido")
        small = self._one(query, "size", "small") != "full"
        template = sources.IMAGE_SMALL_URL if small else sources.IMAGE_URL
        cache_path = os.path.join(
            IMG_CACHE, "%s_%s.jpg" % (raw_id, "s" if small else "f")
        )

        if os.path.exists(cache_path):
            with open(cache_path, "rb") as handle:
                blob = handle.read()
        else:
            blob = self._download_image(template.format(id=raw_id))
            if blob is None:
                return self._error(404, "Immagine non disponibile")
            os.makedirs(IMG_CACHE, exist_ok=True)
            tmp = cache_path + ".part"
            with open(tmp, "wb") as handle:
                handle.write(blob)
            os.replace(tmp, cache_path)

        self._send(200, blob, "image/jpeg",
                   {"Cache-Control": "public, max-age=604800"})

    def _download_image(self, url):
        """Prova il sito, poi un proxy di immagini.

        Diversi provider italiani bloccano i domini Yu-Gi-Oh a livello di
        SNI: senza il secondo tentativo, su quelle reti le carte non si
        vedrebbero mai. Quello che arriva finisce comunque in cache, cosi'
        il giro lungo si fa una volta sola.
        """
        candidates = [
            url,
            "https://images.weserv.nl/?url="
            + urllib.parse.quote(url.split("://", 1)[-1], safe=""),
        ]
        for candidate in candidates:
            req = urllib.request.Request(
                candidate, headers={"User-Agent": sources.USER_AGENT}
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return resp.read()
            except Exception:
                continue
        return None

    def _start_update(self, body):
        if updater.is_running():
            return self._json(
                {"started": False, "reason": "Aggiornamento gia' in corso",
                 "update": updater.status()}, 409)
        pages = body.get("pages_per_format", 5)
        try:
            pages = max(1, min(50, int(pages)))
        except (TypeError, ValueError):
            pages = 5
        formats = body.get("formats") or None
        if formats is not None and not isinstance(formats, list):
            formats = None
        started = updater.start(
            pages_per_format=pages,
            formats=formats,
            with_cards=bool(body.get("with_cards", True)),
            with_tagforce=bool(body.get("with_tagforce", True)),
        )
        return self._json({"started": started, "update": updater.status()})

    # --------------------------------------------------------------- static

    def _resolve(self, path):
        """I dati esportati stanno fuori da web/, ma si servono sotto /data/."""
        clean = posixpath.normpath(path).lstrip("/")
        if clean in ("", "."):
            clean = "index.html"
        if clean == "data" or clean.startswith("data/"):
            base, rest = EXPORT_DIR, clean[len("data"):].lstrip("/")
        else:
            base, rest = WEB_DIR, clean
        target = os.path.join(base, *rest.split("/")) if rest else base
        if not os.path.abspath(target).startswith(os.path.abspath(base)):
            return None
        return target

    def _serve_static(self, path):
        target = self._resolve(path)
        if target is None:
            return self._error(403, "Accesso negato")
        if not os.path.isfile(target):
            if path.startswith("/data/"):
                return self._error(
                    404,
                    "Dati non ancora esportati: premi \"Aggiorna DB\" "
                    "oppure esegui `python app.py --export`.",
                )
            return self._error(404, "File non trovato: %s" % path)

        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in (
            "application/javascript", "application/json"
        ):
            ctype += "; charset=utf-8"
        with open(target, "rb") as handle:
            blob = handle.read()
        self._send(200, blob, ctype, {"Cache-Control": "no-cache"})


def serve(host="127.0.0.1", port=8777):
    db.init()
    # Alla prima apertura i JSON possono non esistere ancora (archivio
    # appena creato, o aggiornamento fatto da una versione precedente).
    if db.stats()["decks"] and not os.path.exists(
        os.path.join(EXPORT_DIR, "decks.json")
    ):
        export.export_all(EXPORT_DIR)
    return ThreadingHTTPServer((host, port), Handler)
