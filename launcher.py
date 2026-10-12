"""Punto di ingresso dell'eseguibile: avvia il server e apre il browser.

Differisce da app.py perche' dentro un .exe non esiste una riga di comando
su cui stampare: gli errori vanno mostrati in una finestra, altrimenti la
console sparisce prima che si riescano a leggere.
"""
import os
import sys
import threading
import webbrowser

PORT_RANGE = range(8777, 8797)


def _base_dir():
    """La cartella dove tenere data/ e web/.

    In un eseguibile PyInstaller i file del pacchetto stanno in una cartella
    temporanea (sys._MEIPASS) che sparisce alla chiusura: l'archivio va
    quindi messo accanto all'eseguibile, non li' dentro.
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _show_error(message):
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None, message, "Yu-Gi-Oh Deck Builder", 0x10
        )
    except Exception:
        print(message, file=sys.stderr)


def _free_port(host, ygodeck_server):
    """La porta preferita puo' essere occupata da un'altra copia dell'app."""
    import socket

    last_error = None
    for port in PORT_RANGE:
        try:
            return ygodeck_server.serve(host, port), port
        except OSError as exc:
            last_error = exc
            continue
    raise last_error


def main():
    base = _base_dir()
    os.chdir(base)

    try:
        from ygodeck import db, server

        # Dentro l'eseguibile i percorsi vanno ancorati alla cartella
        # dell'eseguibile, non a quella dei moduli impacchettati.
        if getattr(sys, "frozen", False):
            db.DB_PATH = os.path.join(base, "data", "ygodeck.db")
            server.WEB_DIR = os.path.join(getattr(sys, "_MEIPASS", base), "web")
            server.IMG_CACHE = os.path.join(base, "data", "imgcache")

        httpd, port = _free_port("127.0.0.1", server)
    except Exception as exc:
        _show_error("Avvio non riuscito:\n\n%s: %s" % (type(exc).__name__, exc))
        return 1

    url = "http://127.0.0.1:%d/" % port
    stats = db.stats()
    print("Yu-Gi-Oh Deck Builder in ascolto su %s" % url)
    print("Archivio: %d mazzi, %d carte" % (stats["decks"], stats["cards"]))
    if stats["decks"] == 0:
        print('Archivio vuoto: premi "Aggiorna DB" nell\'interfaccia.')
    print("Chiudi questa finestra per fermare l'app.")

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
