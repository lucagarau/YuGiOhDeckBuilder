"""Esportazione dell'archivio in JSON statico.

E' il ponte fra le due versioni dell'app. Python resta responsabile di
quello che un browser non puo' fare (scaricare da YGOPRODeck, che non
manda intestazioni CORS, leggere il wiki, dedurre archetipi e strategie);
il risultato viene congelato in questi file, che sono l'unica fonte dati
sia per il server locale sia per il sito su GitHub Pages.

Cosi' le due versioni non possono divergere: la logica di ricerca, filtro,
sorteggio e generazione .ydk vive una volta sola, in web/store.js, e legge
sempre questi stessi file.
"""
import json
import os

from . import db, strategies

# Solo le carte che compaiono davvero nei mazzi: delle ~14.600 del
# database ne servono ~11.600, e il resto sarebbe peso morto da scaricare.
CARD_FIELDS = (
    "id", "name", "type", "frame_type", "race", "attribute",
    "level", "atk", "defense", "archetype", "descr",
)

DECK_FIELDS = (
    "deck_num", "name", "author", "format", "archetype", "archetypes",
    "strategy", "strategies", "cover_card", "views", "price", "pretty_url",
    "excerpt", "tournament_name", "tournament_place", "tournament_players",
    "submit_date", "source", "source_url", "unresolved",
)

JSON_ARGS = dict(ensure_ascii=False, separators=(",", ":"))


def default_dir():
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "export",
    )


def _write(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, **JSON_ARGS)
    os.replace(tmp, path)          # sostituzione atomica: niente file a meta'
    return os.path.getsize(path)


def export_all(target_dir=None):
    """Scrive cards.json, decks.json e meta.json. Ritorna le dimensioni."""
    target_dir = target_dir or default_dir()
    os.makedirs(target_dir, exist_ok=True)
    conn = db.connect()

    decks, used_cards = [], set()
    for row in conn.execute("SELECT * FROM decks"):
        row = dict(row)
        deck = {k: row.get(k) for k in DECK_FIELDS}
        for key in ("archetypes", "strategies", "unresolved"):
            deck[key] = json.loads(row.get(key) or "[]")
        for zone in ("main", "extra", "side"):
            ids = json.loads(row.get(zone + "_json") or "[]")
            deck[zone] = ids
            used_cards.update(ids)
        if not deck["unresolved"]:
            del deck["unresolved"]          # quasi sempre vuoto: non pesarlo
        decks.append(deck)

    # Gli artwork alternativi hanno un passcode proprio: se un mazzo lo usa
    # va esportata comunque la carta vera, altrimenti resta senza nome.
    aliases = {
        r["alias_id"]: r["card_id"]
        for r in conn.execute("SELECT alias_id, card_id FROM card_aliases")
    }
    used_cards.update(aliases[a] for a in list(used_cards) if a in aliases)

    cards = []
    for row in conn.execute("SELECT %s FROM cards" % ", ".join(CARD_FIELDS)):
        if row["id"] in used_cards:
            cards.append({k: row[k] for k in CARD_FIELDS})

    alias_pairs = {
        str(a): c for a, c in aliases.items() if a in used_cards or c in used_cards
    }

    stats = db.stats()
    # Le carte esportate sono solo quelle usate nei mazzi: dichiararne di
    # piu' farebbe apparire nell'interfaccia un numero che non esiste.
    stats["cards"] = len(cards)
    stats["cards_in_archive"] = db.stats()["cards"]
    meta = {
        "stats": stats,
        "strategy_labels": strategies.LABELS,
        "aliases": alias_pairs,
        "generated_at": db.now_iso(),
        "last_card_update": stats.get("last_card_update"),
        "last_deck_update": stats.get("last_deck_update"),
        "last_tagforce_update": db.get_meta("last_tagforce_update"),
    }

    sizes = {
        "cards.json": _write(os.path.join(target_dir, "cards.json"), cards),
        "decks.json": _write(os.path.join(target_dir, "decks.json"), decks),
        "meta.json": _write(os.path.join(target_dir, "meta.json"), meta),
    }
    db.checkpoint()
    return {
        "dir": target_dir,
        "decks": len(decks),
        "cards": len(cards),
        "sizes": sizes,
        "total_bytes": sum(sizes.values()),
    }
