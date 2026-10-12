#!/usr/bin/env python3
"""Avvia il server locale e apre l'interfaccia nel browser.

    python app.py                 porta 8777, apre il browser
    python app.py --port 9000     porta diversa
    python app.py --no-browser    non apre il browser
    python app.py --update        aggiorna il database e termina
"""
import argparse
import sys
import threading
import webbrowser

from ygodeck import db, server, updater


def _run_cli_update(pages):
    db.init()
    if not updater.start(pages_per_format=pages):
        print("Un aggiornamento e' gia' in corso.")
        return 1

    seen = 0
    while True:
        state = updater.status()
        log = state["log"]
        for line in log[seen:]:
            print(line)
        seen = len(log)
        if not state["running"]:
            break
        threading.Event().wait(0.5)

    state = updater.status()
    if state["error"]:
        print("\nErrore: %s" % state["error"], file=sys.stderr)
        return 1
    stats = db.stats()
    print("\nCarte: %d | Mazzi: %d | Formati: %d | Archetipi: %d" % (
        stats["cards"], stats["decks"], stats["formats"], stats["archetypes"]))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Yu-Gi-Oh Deck Builder (.ydk)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8777)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--update", action="store_true",
                        help="aggiorna il database da riga di comando e termina")
    parser.add_argument("--pages", type=int, default=5,
                        help="pagine da scaricare per formato (20 mazzi a pagina)")
    args = parser.parse_args()

    if args.update:
        return _run_cli_update(args.pages)

    httpd = server.serve(args.host, args.port)
    url = "http://%s:%d/" % (args.host, args.port)
    stats = db.stats()

    print("Yu-Gi-Oh Deck Builder in ascolto su %s" % url)
    print("Archivio: %d carte, %d mazzi, %d formati, %d archetipi"
          % (stats["cards"], stats["decks"], stats["formats"], stats["archetypes"]))
    if stats["decks"] == 0:
        print('Archivio vuoto: premi "Aggiorna DB" nell\'interfaccia per popolarlo.')
    print("Ctrl+C per fermare.")

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto...")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
