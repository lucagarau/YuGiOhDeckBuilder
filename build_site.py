#!/usr/bin/env python3
"""Assembla il sito statico per GitHub Pages.

    python build_site.py [cartella]      (default: _site)

Il sito e' la stessa interfaccia della versione locale (web/) piu' i dati
esportati sotto data/. Non c'e' una seconda versione dell'app da tenere
allineata: cambia solo cosa manca intorno, cioe' il server, e
l'interfaccia se ne accorge da sola perche' /api/capabilities non
risponde.
"""
import os
import shutil
import sys

from ygodeck import db, export

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
DEFAULT_OUT = os.path.join(ROOT, "_site")

# GitHub Pages passa i file da Jekyll, che ignora le cartelle che iniziano
# per underscore e puo' rimaneggiare l'HTML: questo file lo disattiva.
NOJEKYLL = ".nojekyll"


def build(out_dir=DEFAULT_OUT, fresh_export=True):
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(WEB, out_dir)

    data_dir = os.path.join(out_dir, "data")
    if fresh_export:
        db.init()
        result = export.export_all(data_dir)
    else:
        shutil.copytree(export.default_dir(), data_dir)
        result = {"decks": "?", "cards": "?"}

    open(os.path.join(out_dir, NOJEKYLL), "w").close()

    total = 0
    for base, _dirs, files in os.walk(out_dir):
        for name in files:
            total += os.path.getsize(os.path.join(base, name))
    return {"dir": out_dir, "bytes": total, "export": result}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    info = build(out)
    print("Sito pronto in %s" % info["dir"])
    print("   mazzi: %s | carte: %s" % (
        info["export"]["decks"], info["export"]["cards"]))
    print("   peso totale: %.1f MB (il browser lo scarica compresso)"
          % (info["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
