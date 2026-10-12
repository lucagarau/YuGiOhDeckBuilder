"""Server HTTP locale: API JSON + file statici dell'interfaccia."""
import json
import mimetypes
import os
import posixpath
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import db, sources, updater, ydk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
IMG_CACHE = os.path.join(ROOT, "data", "imgcache")

# Ordine di visualizzazione dentro ogni sezione del mazzo.
MAIN_GROUPS = ("Mostri", "Magie", "Trappole")


def _zone_group(card):
    kind = (card.get("type") or "").lower()
    if "spell" in kind:
        return "Magie"
    if "trap" in kind:
        return "Trappole"
    return "Mostri"


def _sort_key(card):
    return (
        _zone_group(card) != "Mostri",
        MAIN_GROUPS.index(_zone_group(card)),
        -(card.get("level") or 0),
        card.get("name") or "",
    )


def _expand(ids, cards):
    """Da lista di passcode ripetuti a voci con quantita', dati e immagine."""
    counts, order = {}, []
    for cid in ids:
        if cid not in counts:
            order.append(cid)
        counts[cid] = counts.get(cid, 0) + 1

    entries = []
    for cid in order:
        card = cards.get(cid) or {"id": cid, "name": "Carta sconosciuta (%d)" % cid}
        entries.append({
            "id": cid,
            "qty": counts[cid],
            "name": card.get("name"),
            "type": card.get("type"),
            "frame_type": card.get("frame_type"),
            "race": card.get("race"),
            "attribute": card.get("attribute"),
            "level": card.get("level"),
            "atk": card.get("atk"),
            "defense": card.get("defense"),
            "archetype": card.get("archetype"),
            "descr": card.get("descr"),
            "group": _zone_group(card),
        })
    entries.sort(key=lambda e: _sort_key(e))
    return entries


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
        if path == "/api/status":
            return self._json({"stats": db.stats(), "update": updater.status()})
        if path == "/api/update":
            return self._json(updater.status())
        if path == "/api/formats":
            return self._json({
                "available": sources.FORMATS,
                "in_db": db.distinct_formats(),
            })
        if path == "/api/archetypes":
            return self._json({
                "in_db": db.distinct_archetypes(),
                "known": db.get_archetype_names(),
            })
        if path == "/api/decks":
            return self._search(query)
        if path.startswith("/api/img/"):
            return self._image(path, query)

        if path.startswith("/api/decks/"):
            rest = path[len("/api/decks/"):].strip("/")
            parts = rest.split("/")
            if not parts[0].isdigit():
                return self._error(400, "Numero mazzo non valido")
            deck_num = int(parts[0])
            if len(parts) == 1:
                return self._deck_detail(deck_num)
            if len(parts) == 2 and parts[1] == "ydk":
                return self._deck_ydk(deck_num)

        return self._error(404, "Endpoint non trovato: %s" % path)

    def _one(self, query, key, default=""):
        values = query.get(key) or []
        return values[0].strip() if values else default

    def _search(self, query):
        result = db.search_decks(
            q=self._one(query, "q"),
            fmt=self._one(query, "format"),
            archetype=self._one(query, "archetype"),
            card_id=self._one(query, "card_id") or None,
            sort=self._one(query, "sort", "recent"),
            page=int(self._one(query, "page", "1") or 1),
            per_page=int(self._one(query, "per_page", "24") or 24),
        )
        return self._json(result)

    def _deck_detail(self, deck_num):
        deck = db.get_deck(deck_num)
        if not deck:
            return self._error(404, "Mazzo non presente in archivio")

        # Il side deck non arriva con la lista: lo recuperiamo alla prima
        # apertura del mazzo e lo mettiamo in archivio.
        if not deck["side_fetched"]:
            try:
                side = sources.fetch_side_deck(deck["pretty_url"])
                db.save_side_deck(deck_num, side)
                deck["side"] = side
                deck["side_fetched"] = 1
            except sources.SourceError as exc:
                deck["side_warning"] = str(exc)

        ids = set(deck["main"]) | set(deck["extra"]) | set(deck["side"])
        if deck.get("cover_card"):
            ids.add(deck["cover_card"])
        cards = db.cards_by_ids(ids)

        deck["main_cards"] = _expand(deck["main"], cards)
        deck["extra_cards"] = _expand(deck["extra"], cards)
        deck["side_cards"] = _expand(deck["side"], cards)
        deck["missing_cards"] = sorted(i for i in ids if i not in cards)
        deck["ydk_preview"] = ydk.build(deck)
        deck["ydk_filename"] = ydk.filename(deck)
        return self._json(deck)

    def _deck_ydk(self, deck_num):
        deck = db.get_deck(deck_num)
        if not deck:
            return self._error(404, "Mazzo non presente in archivio")
        if not deck["side_fetched"]:
            try:
                side = sources.fetch_side_deck(deck["pretty_url"])
                db.save_side_deck(deck_num, side)
                deck["side"] = side
            except sources.SourceError:
                pass  # meglio un .ydk senza side che nessun file

        name = ydk.filename(deck)
        ascii_name = name.encode("ascii", "ignore").decode("ascii") or "deck.ydk"
        disposition = 'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (
            ascii_name,
            urllib.parse.quote(name),
        )
        self._send(
            200,
            ydk.build(deck),
            "application/octet-stream",
            {"Content-Disposition": disposition, "Cache-Control": "no-store"},
        )

    def _image(self, path, query):
        """Proxy con cache su disco: evita le chiamate dirette dal browser."""
        raw_id = path[len("/api/img/"):].strip("/")
        if not raw_id.isdigit():
            return self._error(400, "Passcode non valido")
        small = self._one(query, "size", "small") != "full"
        template = sources.IMAGE_SMALL_URL if small else sources.IMAGE_URL
        cache_name = "%s_%s.jpg" % (raw_id, "s" if small else "f")
        cache_path = os.path.join(IMG_CACHE, cache_name)

        blob = None
        if os.path.exists(cache_path):
            with open(cache_path, "rb") as handle:
                blob = handle.read()
        else:
            req = urllib.request.Request(
                template.format(id=raw_id),
                headers={"User-Agent": sources.USER_AGENT},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    blob = resp.read()
                os.makedirs(IMG_CACHE, exist_ok=True)
                tmp = cache_path + ".part"
                with open(tmp, "wb") as handle:
                    handle.write(blob)
                os.replace(tmp, cache_path)
            except Exception:
                return self._error(404, "Immagine non disponibile")

        self._send(200, blob, "image/jpeg",
                   {"Cache-Control": "public, max-age=604800"})

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
        )
        return self._json({"started": started, "update": updater.status()})

    # --------------------------------------------------------------- static

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        # Normalizzazione contro i path traversal.
        clean = posixpath.normpath(path).lstrip("/")
        target = os.path.join(WEB_DIR, *clean.split("/"))
        if not os.path.abspath(target).startswith(os.path.abspath(WEB_DIR)):
            return self._error(403, "Accesso negato")
        if not os.path.isfile(target):
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
    httpd = ThreadingHTTPServer((host, port), Handler)
    return httpd
