"""Aggiornamento del database su richiesta, con avanzamento leggibile.

Gira in un thread separato: il tasto "Aggiorna DB" avvia il job e poi
l'interfaccia interroga stato() per la barra di avanzamento.
"""
import threading
import time

from . import db, sources, strategies, tagforce

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


def start(pages_per_format=5, formats=None, with_cards=True,
          with_tagforce=True):
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
        args=(int(pages_per_format), formats, bool(with_cards),
              bool(with_tagforce)),
        daemon=True,
    )
    thread.start()
    return True


def _ingest_tagforce(arch_map, name_index, tagger):
    """Mazzi della saga Tag Force dal wiki: ~3.500 mazzi in poche richieste."""
    _log("Tag Force: cerco le pagine dei personaggi sul wiki...")
    pages = tagforce.fetch_character_pages()
    default_game = {}
    for title, games in pages.items():
        # Se il personaggio compare in un solo gioco, quello e' anche il
        # gioco dei mazzi privi di intestazione nella pagina.
        if len(games) == 1:
            default_game[title] = next(iter(games))
    titles = sorted(pages)
    titles += [t for t in tagforce.RECIPE_PAGES if t not in pages]
    _log("Tag Force: %d pagine da leggere." % len(titles))

    card_index = tagforce.build_name_index(
        db.connect().execute("SELECT id, name FROM cards")
    )

    # Un mazzo puo' comparire su piu' pagine: conta una volta sola.
    seen = set()
    for i in range(0, len(titles), tagforce.BATCH):
        chunk = titles[i : i + tagforce.BATCH]
        texts = tagforce.fetch_wikitext(chunk)
        batch = []
        for title, text in texts.items():
            fallback = tagforce.RECIPE_PAGES.get(title) or default_game.get(title)
            for parsed in tagforce.parse_page(text, default_game=fallback):
                deck = tagforce.to_deck(parsed, title, card_index)
                if not deck:
                    continue
                deck["archetypes"] = sources.derive_archetypes(
                    deck["name"], deck["main"], deck["extra"], arch_map, name_index
                )
                deck["archetype"] = (
                    deck["archetypes"][0] if deck["archetypes"] else ""
                )
                deck["strategies"] = tagger.tag(
                    deck["name"], deck["main"], deck["extra"]
                )
                batch.append(deck)
        if batch:
            # Le pagine possono ripetere lo stesso mazzo; l'ultimo vince.
            unique = {d["deck_num"]: d for d in batch}
            db.upsert_decks(list(unique.values()))
            seen.update(unique)
        _log("Tag Force: %d/%d pagine, %d mazzi." % (
            min(i + tagforce.BATCH, len(titles)), len(titles), len(seen)))

    db.set_meta("last_tagforce_update", db.now_iso())
    return len(seen)


def _run(pages_per_format, formats, with_cards, with_tagforce=True):
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

        tagger = strategies.Tagger(db.card_index_rows())

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
                        deck["strategies"] = tagger.tag(
                            deck["name"], deck["main"], deck["extra"]
                        )
                        normalized.append(deck)
                if normalized:
                    db.upsert_decks(normalized)
                    deck_total += len(normalized)
                done += 1
                _set(done=done, decks_saved=deck_total)

        if with_tagforce:
            _set(phase="tagforce")
            try:
                deck_total += _ingest_tagforce(arch_map, name_index, tagger)
            except tagforce.TagForceError as exc:
                _log("Tag Force saltato: %s" % exc)
            _set(decks_saved=deck_total)

        # I mazzi gia' in archivio da prima di questa funzione non hanno
        # ancora una strategia: si ricalcola senza riscaricarli.
        _set(phase="strategies")
        _log("Riconosco il funzionamento dei mazzi rimasti senza etichetta...")
        retagged = db.retag_strategies(tagger, only_missing=True)
        if retagged:
            _log("Funzionamento assegnato a %d mazzi gia' in archivio." % retagged)

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
