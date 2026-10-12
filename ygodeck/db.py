"""Accesso a SQLite: schema, upsert e query di ricerca."""
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "ygodeck.db"
)

SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT,
    frame_type  TEXT,
    race        TEXT,
    attribute   TEXT,
    level       INTEGER,
    atk         INTEGER,
    defense     INTEGER,
    archetype   TEXT,
    descr       TEXT
);

-- Gli artwork alternativi hanno un passcode proprio: i mazzi possono usarlo
-- al posto di quello canonico, quindi va ricondotto alla carta vera.
CREATE TABLE IF NOT EXISTS card_aliases (
    alias_id INTEGER PRIMARY KEY,
    card_id  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS decks (
    deck_num            INTEGER PRIMARY KEY,
    name                TEXT,
    author              TEXT,
    format              TEXT,
    archetype           TEXT,
    archetypes          TEXT,
    strategy            TEXT,
    strategies          TEXT,
    main_json           TEXT,
    extra_json          TEXT,
    side_json           TEXT,
    side_fetched        INTEGER DEFAULT 0,
    cover_card          INTEGER,
    views               INTEGER,
    price               REAL,
    pretty_url          TEXT,
    excerpt             TEXT,
    description         TEXT,
    tournament_name     TEXT,
    tournament_place    TEXT,
    tournament_players  INTEGER,
    submit_date         TEXT,
    source              TEXT DEFAULT 'ygoprodeck',
    source_url          TEXT,
    unresolved          TEXT,
    fetched_at          TEXT
);

CREATE TABLE IF NOT EXISTS deck_cards (
    deck_num INTEGER NOT NULL,
    card_id  INTEGER NOT NULL,
    zone     TEXT NOT NULL,
    qty      INTEGER NOT NULL,
    PRIMARY KEY (deck_num, card_id, zone)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# Gli indici si creano dopo la migrazione: possono toccare colonne che
# un archivio creato da una versione precedente non ha ancora.
SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_archetype ON cards(archetype);
CREATE INDEX IF NOT EXISTS idx_decks_format ON decks(format);
CREATE INDEX IF NOT EXISTS idx_decks_archetype ON decks(archetype);
CREATE INDEX IF NOT EXISTS idx_decks_strategy ON decks(strategy);
CREATE INDEX IF NOT EXISTS idx_decks_source ON decks(source);
CREATE INDEX IF NOT EXISTS idx_decks_name ON decks(name);
CREATE INDEX IF NOT EXISTS idx_deck_cards_card ON deck_cards(card_id);
"""

_local = threading.local()


def connect():
    """Una connessione per thread: SQLite non ammette la condivisione."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn = conn
    return conn


# Colonne aggiunte dopo la prima versione: gli archivi gia' creati non le
# hanno, e CREATE TABLE IF NOT EXISTS non le aggiunge.
MIGRATIONS = {
    "decks": {
        "strategy": "TEXT",
        "strategies": "TEXT",
        "source": "TEXT DEFAULT 'ygoprodeck'",
        "source_url": "TEXT",
        "unresolved": "TEXT",
    },
}


def _migrate(conn):
    for table, columns in MIGRATIONS.items():
        existing = {
            r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table)
        }
        if not existing:
            continue
        for column, kind in columns.items():
            if column not in existing:
                conn.execute(
                    "ALTER TABLE %s ADD COLUMN %s %s" % (table, column, kind)
                )


def init():
    conn = connect()
    conn.executescript(SCHEMA_TABLES)
    _migrate(conn)
    conn.executescript(SCHEMA_INDEXES)
    conn.commit()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------ meta

def set_meta(key, value):
    conn = connect()
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )
    conn.commit()


def get_meta(key, default=None):
    row = connect().execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_archetype_names(names):
    """Vocabolario degli archetipi noti al sito, usato per leggere i titoli."""
    set_meta("archetype_names", json.dumps(sorted(set(names or []))))


def get_archetype_names():
    try:
        return json.loads(get_meta("archetype_names") or "[]")
    except ValueError:
        return []


# ----------------------------------------------------------------- cards

def upsert_cards(cards):
    """cards: lista di dict grezzi dall'endpoint cardinfo di YGOPRODeck."""
    rows = [
        (
            int(c["id"]),
            c.get("name"),
            c.get("type"),
            c.get("frameType"),
            c.get("race"),
            c.get("attribute"),
            c.get("level"),
            c.get("atk"),
            c.get("def"),
            c.get("archetype"),
            c.get("desc"),
        )
        for c in cards
        if c.get("id") is not None
    ]
    conn = connect()
    conn.executemany(
        "INSERT INTO cards(id, name, type, frame_type, race, attribute, level, atk,"
        " defense, archetype, descr) VALUES(?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type,"
        " frame_type=excluded.frame_type, race=excluded.race,"
        " attribute=excluded.attribute, level=excluded.level, atk=excluded.atk,"
        " defense=excluded.defense, archetype=excluded.archetype,"
        " descr=excluded.descr",
        rows,
    )

    canonical = {r[0] for r in rows}
    aliases = []
    for c in cards:
        cid = c.get("id")
        if cid is None:
            continue
        for image in c.get("card_images") or []:
            alias = image.get("id")
            if alias is not None and alias != cid and alias not in canonical:
                aliases.append((int(alias), int(cid)))
    if aliases:
        conn.executemany(
            "INSERT INTO card_aliases(alias_id, card_id) VALUES(?, ?)"
            " ON CONFLICT(alias_id) DO UPDATE SET card_id=excluded.card_id",
            aliases,
        )

    conn.commit()
    return len(rows)


CARD_COLUMNS = (
    "id, name, type, frame_type, race, attribute, level, atk, defense,"
    " archetype, descr"
)


def card_archetype_map():
    """{passcode: archetipo} per le carte che ne hanno uno, alias inclusi."""
    conn = connect()
    out = {
        r["id"]: r["archetype"]
        for r in conn.execute(
            "SELECT id, archetype FROM cards"
            " WHERE archetype IS NOT NULL AND archetype <> ''"
        )
    }
    for r in conn.execute(
        "SELECT a.alias_id, c.archetype FROM card_aliases a"
        " JOIN cards c ON c.id = a.card_id"
        " WHERE c.archetype IS NOT NULL AND c.archetype <> ''"
    ):
        out[r["alias_id"]] = r["archetype"]
    return out


def cards_by_ids(ids):
    """{passcode richiesto: dict carta}, risolvendo i passcode alternativi."""
    ids = list(ids)
    if not ids:
        return {}
    conn = connect()
    out = {}

    def fetch(chunk):
        marks = ",".join("?" * len(chunk))
        return conn.execute(
            "SELECT " + CARD_COLUMNS + " FROM cards WHERE id IN (" + marks + ")",
            chunk,
        )

    for i in range(0, len(ids), 800):
        chunk = ids[i : i + 800]
        for r in fetch(chunk):
            out[r["id"]] = dict(r)

    # I passcode rimasti fuori possono essere artwork alternativi.
    missing = [i for i in ids if i not in out]
    if missing:
        alias_to_card = {}
        for i in range(0, len(missing), 800):
            chunk = missing[i : i + 800]
            marks = ",".join("?" * len(chunk))
            for r in conn.execute(
                "SELECT alias_id, card_id FROM card_aliases"
                " WHERE alias_id IN (" + marks + ")",
                chunk,
            ):
                alias_to_card[r["alias_id"]] = r["card_id"]
        if alias_to_card:
            targets = list(set(alias_to_card.values()))
            by_canonical = {}
            for i in range(0, len(targets), 800):
                for r in fetch(targets[i : i + 800]):
                    by_canonical[r["id"]] = dict(r)
            for alias, canonical in alias_to_card.items():
                card = by_canonical.get(canonical)
                if card:
                    out[alias] = card
    return out


# ----------------------------------------------------------------- decks

def upsert_decks(decks):
    """decks: lista di dict gia' normalizzati da sources.normalize_deck."""
    conn = connect()
    ts = now_iso()
    for d in decks:
        conn.execute(
            "INSERT INTO decks(deck_num, name, author, format, archetype, archetypes,"
            " strategy, strategies,"
            " main_json, extra_json, side_json, side_fetched, cover_card, views, price,"
            " pretty_url, excerpt, description, tournament_name, tournament_place,"
            " tournament_players, submit_date, source, source_url, unresolved,"
            " fetched_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(deck_num) DO UPDATE SET"
            "  name=excluded.name, author=excluded.author, format=excluded.format,"
            "  archetype=excluded.archetype, archetypes=excluded.archetypes,"
            "  strategy=excluded.strategy, strategies=excluded.strategies,"
            "  main_json=excluded.main_json, extra_json=excluded.extra_json,"
            "  cover_card=excluded.cover_card, views=excluded.views,"
            "  price=excluded.price, pretty_url=excluded.pretty_url,"
            "  excerpt=excluded.excerpt, description=excluded.description,"
            "  tournament_name=excluded.tournament_name,"
            "  tournament_place=excluded.tournament_place,"
            "  tournament_players=excluded.tournament_players,"
            "  submit_date=excluded.submit_date, source=excluded.source,"
            "  source_url=excluded.source_url, unresolved=excluded.unresolved,"
            "  fetched_at=excluded.fetched_at",
            (
                d["deck_num"],
                d["name"],
                d["author"],
                d["format"],
                d["archetype"],
                json.dumps(d["archetypes"]),
                (d.get("strategies") or [None])[0],
                json.dumps(d.get("strategies") or []),
                json.dumps(d["main"]),
                json.dumps(d["extra"]),
                json.dumps(d["side"]),
                d.get("side_fetched", 1 if d["side"] else 0),
                d["cover_card"],
                d["views"],
                d["price"],
                d["pretty_url"],
                d["excerpt"],
                d["description"],
                d["tournament_name"],
                d["tournament_place"],
                d["tournament_players"],
                d["submit_date"],
                d.get("source") or "ygoprodeck",
                d.get("source_url"),
                json.dumps(d.get("unresolved") or []),
                ts,
            ),
        )
        _replace_deck_cards(conn, d["deck_num"], d)
    conn.commit()
    return len(decks)


def _replace_deck_cards(conn, deck_num, d):
    conn.execute("DELETE FROM deck_cards WHERE deck_num=?", (deck_num,))
    rows = []
    for zone in ("main", "extra", "side"):
        counts = {}
        for cid in d[zone]:
            counts[cid] = counts.get(cid, 0) + 1
        rows += [(deck_num, cid, zone, q) for cid, q in counts.items()]
    if rows:
        conn.executemany(
            "INSERT OR REPLACE INTO deck_cards(deck_num, card_id, zone, qty)"
            " VALUES(?,?,?,?)",
            rows,
        )


def save_side_deck(deck_num, side):
    """Il side deck non e' nella risposta della lista: arriva separatamente."""
    conn = connect()
    conn.execute(
        "UPDATE decks SET side_json=?, side_fetched=1 WHERE deck_num=?",
        (json.dumps(side), deck_num),
    )
    conn.execute("DELETE FROM deck_cards WHERE deck_num=? AND zone='side'", (deck_num,))
    counts = {}
    for cid in side:
        counts[cid] = counts.get(cid, 0) + 1
    if counts:
        conn.executemany(
            "INSERT OR REPLACE INTO deck_cards(deck_num, card_id, zone, qty)"
            " VALUES(?,?,'side',?)",
            [(deck_num, cid, q) for cid, q in counts.items()],
        )
    conn.commit()


SORTS = {
    "recent": "deck_num DESC",
    "views": "views DESC, deck_num DESC",
    "price_asc": "price ASC, deck_num DESC",
    "price_desc": "price DESC, deck_num DESC",
    "name": "name COLLATE NOCASE ASC",
}


def card_index_rows():
    """Tutte le carte piu' gli alias, nella forma attesa dal Tagger."""
    conn = connect()
    rows = {
        r["id"]: dict(r)
        for r in conn.execute(
            "SELECT id, name, descr, type, attribute, archetype FROM cards"
        )
    }
    for r in conn.execute(
        "SELECT a.alias_id AS id, c.name, c.descr, c.type, c.attribute, c.archetype"
        " FROM card_aliases a JOIN cards c ON c.id = a.card_id"
    ):
        rows[r["id"]] = dict(r)
    return rows


def retag_strategies(tagger, only_missing=False, batch=400, progress=None):
    """Ricalcola la strategia dei mazzi gia' in archivio, senza riscaricarli."""
    conn = connect()
    clause = " WHERE strategy IS NULL OR strategy = ''" if only_missing else ""
    rows = conn.execute(
        "SELECT deck_num, name, main_json, extra_json FROM decks" + clause
    ).fetchall()

    updates, done = [], 0
    for r in rows:
        keys = tagger.tag(
            r["name"],
            json.loads(r["main_json"] or "[]"),
            json.loads(r["extra_json"] or "[]"),
        )
        updates.append((keys[0] if keys else None, json.dumps(keys), r["deck_num"]))
        if len(updates) >= batch:
            conn.executemany(
                "UPDATE decks SET strategy=?, strategies=? WHERE deck_num=?", updates
            )
            conn.commit()
            done += len(updates)
            updates = []
            if progress:
                progress(done, len(rows))
    if updates:
        conn.executemany(
            "UPDATE decks SET strategy=?, strategies=? WHERE deck_num=?", updates
        )
        conn.commit()
        done += len(updates)
        if progress:
            progress(done, len(rows))
    return done


def search_decks(q="", fmt="", archetype="", strategy="", card_id=None,
                 sort="recent", page=1, per_page=24):
    where, params = [], []
    if q:
        where.append("(name LIKE ? OR author LIKE ? OR excerpt LIKE ?)")
        like = "%" + q + "%"
        params += [like, like, like]
    if fmt:
        # L'API usa "goat format decks", i mazzi tornano con "Goat Format
        # Decks": confronto senza distinzione di maiuscole.
        where.append("format = ? COLLATE NOCASE")
        params.append(fmt)
    if archetype:
        where.append("(archetype = ? OR archetypes LIKE ?)")
        params += [archetype, '%"' + archetype + '"%']
    if strategy:
        where.append("(strategy = ? OR strategies LIKE ?)")
        params += [strategy, '%"' + strategy + '"%']
    if card_id:
        where.append("deck_num IN (SELECT deck_num FROM deck_cards WHERE card_id = ?)")
        params.append(int(card_id))

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    conn = connect()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM decks" + clause, params
    ).fetchone()["n"]

    order = SORTS.get(sort, SORTS["recent"])
    per_page = max(1, min(96, int(per_page)))
    page = max(1, int(page))
    cur = conn.execute(
        "SELECT deck_num, name, author, format, archetype, archetypes, strategy,"
        " strategies, cover_card,"
        " views, price, pretty_url, excerpt, tournament_name, tournament_place,"
        " tournament_players, submit_date, source, source_url,"
        " main_json, extra_json, side_json"
        " FROM decks" + clause + " ORDER BY " + order + " LIMIT ? OFFSET ?",
        params + [per_page, (page - 1) * per_page],
    )
    items = []
    for r in cur:
        d = dict(r)
        d["archetypes"] = json.loads(d["archetypes"] or "[]")
        d["strategies"] = json.loads(d["strategies"] or "[]")
        d["main_count"] = len(json.loads(d.pop("main_json") or "[]"))
        d["extra_count"] = len(json.loads(d.pop("extra_json") or "[]"))
        d["side_count"] = len(json.loads(d.pop("side_json") or "[]"))
        items.append(d)
    return {"total": total, "page": page, "per_page": per_page, "items": items}


def random_deck(formats=None, archetypes=None, strategies=None, q=""):
    """Un mazzo a caso fra quelli che soddisfano i filtri, o None.

    Formati, archetipi e strategie sono liste: valgono in OR fra loro e in
    AND fra categorie diverse ("un mazzo Goat o Edison, ma burn").
    """
    where, params = [], []

    def any_of(column, values, json_column=None):
        values = [v for v in (values or []) if v]
        if not values:
            return
        marks = ",".join("?" * len(values))
        clause = column + " COLLATE NOCASE IN (" + marks + ")"
        params.extend(values)
        if json_column:
            likes = " OR ".join([json_column + " LIKE ?"] * len(values))
            clause = "(" + clause + " OR " + likes + ")"
            params.extend('%"' + v + '"%' for v in values)
        where.append(clause)

    any_of("format", formats)
    any_of("archetype", archetypes, "archetypes")
    any_of("strategy", strategies, "strategies")
    if q:
        where.append("(name LIKE ? OR author LIKE ?)")
        params += ["%" + q + "%", "%" + q + "%"]

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    row = connect().execute(
        "SELECT deck_num FROM decks" + clause + " ORDER BY RANDOM() LIMIT 1",
        params,
    ).fetchone()
    return row["deck_num"] if row else None


def count_decks(formats=None, archetypes=None, strategies=None, q=""):
    """Quanti mazzi pescherebbe random_deck con gli stessi filtri."""
    where, params = [], []
    for column, values, json_column in (
        ("format", formats, None),
        ("archetype", archetypes, "archetypes"),
        ("strategy", strategies, "strategies"),
    ):
        values = [v for v in (values or []) if v]
        if not values:
            continue
        marks = ",".join("?" * len(values))
        clause = column + " COLLATE NOCASE IN (" + marks + ")"
        params.extend(values)
        if json_column:
            likes = " OR ".join([json_column + " LIKE ?"] * len(values))
            clause = "(" + clause + " OR " + likes + ")"
            params.extend('%"' + v + '"%' for v in values)
        where.append(clause)
    if q:
        where.append("(name LIKE ? OR author LIKE ?)")
        params += ["%" + q + "%", "%" + q + "%"]
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return connect().execute(
        "SELECT COUNT(*) AS n FROM decks" + clause, params
    ).fetchone()["n"]


def get_deck(deck_num):
    row = connect().execute(
        "SELECT * FROM decks WHERE deck_num=?", (deck_num,)
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["archetypes"] = json.loads(d["archetypes"] or "[]")
    d["strategies"] = json.loads(d["strategies"] or "[]")
    d["unresolved"] = json.loads(d["unresolved"] or "[]")
    for zone in ("main", "extra", "side"):
        d[zone] = json.loads(d.pop(zone + "_json") or "[]")
    return d


def distinct_formats():
    cur = connect().execute(
        "SELECT format, COUNT(*) AS n FROM decks"
        " WHERE format IS NOT NULL AND format <> ''"
        " GROUP BY format ORDER BY n DESC"
    )
    return [{"name": r["format"], "count": r["n"]} for r in cur]


def distinct_archetypes():
    cur = connect().execute(
        "SELECT archetype, COUNT(*) AS n FROM decks"
        " WHERE archetype IS NOT NULL AND archetype <> ''"
        " GROUP BY archetype ORDER BY n DESC, archetype ASC"
    )
    return [{"name": r["archetype"], "count": r["n"]} for r in cur]


def distinct_strategies():
    cur = connect().execute(
        "SELECT strategy, COUNT(*) AS n FROM decks"
        " WHERE strategy IS NOT NULL AND strategy <> ''"
        " GROUP BY strategy ORDER BY n DESC, strategy ASC"
    )
    return [{"key": r["strategy"], "count": r["n"]} for r in cur]


def stats():
    conn = connect()
    return {
        "cards": conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"],
        "decks": conn.execute("SELECT COUNT(*) AS n FROM decks").fetchone()["n"],
        "formats": conn.execute(
            "SELECT COUNT(DISTINCT format) AS n FROM decks"
        ).fetchone()["n"],
        "archetypes": conn.execute(
            "SELECT COUNT(DISTINCT archetype) AS n FROM decks WHERE archetype <> ''"
        ).fetchone()["n"],
        "last_card_update": get_meta("last_card_update"),
        "last_deck_update": get_meta("last_deck_update"),
    }
