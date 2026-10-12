"""Aggiornamento del database su richiesta, con avanzamento leggibile.

Gira in un thread separato: il tasto "Aggiorna DB" avvia il job e poi
l'interfaccia interroga stato() per la barra di avanzamento.
"""
import threading
import time

from . import db, sources

_lock = threading.Lock()
_state = {
    "running": False,
    "phase": "idle",
    "message": "Nessun aggiornamento avviato",
    "done": 0,
    "total": 0,
    "decks_saved": 0,
    "cards_saved": 0,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "log": [],
}


def status():
    with _lock:
        snapshot = dict(_state)
        snapshot["log"] = list(_state["log"])[-40:]
        return snapshot


def _set(**kwargs):
    with _lock:
        _state.update(kwargs)


def _log(line):
    with _lock:
        _state["log"].append("[%s] %s" % (time.strftime("%H:%M:%S"), line))
        _state["message"] = line


def is_running():
    with _lock:
        return _state["running"]


def start(pages_per_format=5, formats=None, with_cards=True):
    """Avvia l'aggiornamento. Restituisce False se ne sta gia' girando uno."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            phase="starting",
            message="Avvio aggiornamento...",
            done=0,
            total=0,
            decks_saved=0,
            cards_saved=0,
            started_at=db.now_iso(),
            finished_at=None,
            error=None,
            log=[],
        )
    thread = threading.Thread(
        target=_run,
        args=(int(pages_per_format), formats, bool(with_cards)),
        daemon=True,
    )
    thread.start()
    return True


def _run(pages_per_format, formats, with_cards):
    try:
        formats = [f for f in (formats or sources.FORMATS) if f in sources.FORMATS]
        if not formats:
            formats = list(sources.FORMATS)

        # Le carte servono prima dei mazzi: l'archetipo del mazzo si deduce
        # dagli archetipi delle sue carte.
        total_steps = len(formats) * pages_per_format + (1 if with_cards else 0)
        _set(total=total_steps, phase="cards")

        if with_cards:
            _log("Scarico il database carte da YGOPRODeck...")
            cards = sources.fetch_all_cards()
            saved = db.upsert_cards(cards)
            db.set_meta("last_card_update", db.now_iso())
            db.set_meta("card_count", saved)
            _set(cards_saved=saved, done=1)
            _log("Salvate %d carte." % saved)
        elif db.stats()["cards"] == 0:
            _log("Nessuna carta in archivio: scarico comunque il database carte.")
            cards = sources.fetch_all_cards()
            saved = db.upsert_cards(cards)
            db.set_meta("last_card_update", db.now_iso())
            _set(cards_saved=saved)
            _log("Salvate %d carte." % saved)

        arch_map = db.card_archetype_map()

        # Il vocabolario degli archetipi serve a riconoscerli nei titoli.
        try:
            names = sources.fetch_archetypes()
            if names:
                db.set_archetype_names(names)
        except sources.SourceError as exc:
            _log("Elenco archetipi non scaricato (%s): uso quello in archivio." % exc)
        name_index = sources.build_name_index(db.get_archetype_names())
        _log("Riconoscimento archetipi: %d carte mappate, %d nomi noti."
             % (len(arch_map), len(name_index)))

        _set(phase="decks")
        done = 1 if with_cards else 0
        deck_total = 0

        for fmt in formats:
            empty = False
            for page in range(pages_per_format):
                if empty:
                    # Formato esaurito: salto le pagine restanti ma tengo
                    # il conteggio allineato alla barra di avanzamento.
                    done += 1
                    _set(done=done)
                    continue
                offset = page * sources.PAGE_SIZE
                _log("%s - pagina %d" % (fmt, page + 1))
                try:
                    raw_decks = sources.fetch_deck_page(fmt=fmt, offset=offset)
                except sources.SourceError as exc:
                    _log("Errore su %s pagina %d: %s" % (fmt, page + 1, exc))
                    raw_decks = []
                if not raw_decks:
                    empty = True
                    done += 1
                    _set(done=done)
                    continue

                normalized = []
                for raw in raw_decks:
                    deck = sources.normalize_deck(raw, arch_map, name_index)
                    if deck["deck_num"] and deck["main"]:
                        normalized.append(deck)
                if normalized:
                    db.upsert_decks(normalized)
                    deck_total += len(normalized)
                done += 1
                _set(done=done, decks_saved=deck_total)

        db.set_meta("last_deck_update", db.now_iso())
        _set(phase="done", finished_at=db.now_iso(), running=False)
        _log("Aggiornamento completato: %d mazzi in archivio." % deck_total)

    except sources.SourceError as exc:
        _set(phase="error", error=str(exc), running=False, finished_at=db.now_iso())
        _log("Aggiornamento interrotto: %s" % exc)
    except Exception as exc:  # il thread non deve morire in silenzio
        _set(
            phase="error",
            error="%s: %s" % (type(exc).__name__, exc),
            running=False,
            finished_at=db.now_iso(),
        )
        _log("Errore inatteso: %s" % exc)
