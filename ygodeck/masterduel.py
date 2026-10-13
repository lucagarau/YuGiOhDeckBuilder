"""Mazzi del meta di Master Duel, da masterduelmeta.com.

YGOPRODeck ha una categoria Master Duel, ma non i piazzamenti: qui ci sono
i mazzi che hanno davvero fatto risultato, con il rango raggiunto o il
torneo vinto.

Le carte nei mazzi sono indicate con un identificativo interno del sito,
non con il passcode: serve prima la tabella delle carte per tradurli. Il
campo `konamiID` e' il passcode vero - verificato su 2.975 carte, 99,9%
di corrispondenza col database di YGOPRODeck e nessun codice sconosciuto.
"""
import hashlib
import json
import urllib.parse
import urllib.request

API = "https://www.masterduelmeta.com/api/v1"
SITE = "https://www.masterduelmeta.com"
USER_AGENT = "YuGiOhDeckBuilder/1.4 (local tool)"

FORMAT_NAME = "Master Duel Meta"

# Intervallo riservato: YGOPRODeck sta sotto il milione, Tag Force sopra
# il miliardo, questi sopra i due miliardi.
DECK_NUM_BASE = 2_000_000_000

PAGE_SIZE = 200
MAX_PAGES = 12


class MasterDuelError(RuntimeError):
    pass


def _get(path, timeout=90):
    url = API + path
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:
        raise MasterDuelError("masterduelmeta non raggiungibile: %s" % exc) from exc


def fetch_card_map(timeout=180):
    """{identificativo del sito: passcode} per tradurre le liste."""
    out = {}
    page = 1
    while page <= 40:
        data = _get("/cards?limit=%d&page=%d" % (PAGE_SIZE * 5, page), timeout)
        if not data:
            break
        for card in data:
            code = card.get("konamiID")
            if card.get("_id") and str(code).isdigit():
                out[card["_id"]] = int(code)
        if len(data) < PAGE_SIZE * 5:
            break
        page += 1
    if not out:
        raise MasterDuelError("tabella delle carte vuota")
    return out


def fetch_top_decks(pages=MAX_PAGES, per_page=PAGE_SIZE, timeout=90, progress=None):
    """I mazzi piu' recenti che hanno fatto risultato."""
    decks = []
    for page in range(1, max(1, pages) + 1):
        # Senza ordinamento il sito parte dai mazzi piu' vecchi (2022):
        # per una fonte di meta servono i piu' recenti.
        data = _get(
            "/top-decks?limit=%d&page=%d&sort=-created" % (per_page, page), timeout
        )
        if not data:
            break
        decks.extend(data)
        if progress:
            progress(page, len(decks))
        if len(data) < per_page:
            break
    return decks


def _field(value, key):
    """Il sito usa a volte un oggetto, a volte direttamente la stringa."""
    if isinstance(value, dict):
        return value.get(key)
    if isinstance(value, str):
        return value or None
    return None


def _zone(entries, card_map, unresolved):
    """Da [{card, amount}] alla lista di passcode ripetuti."""
    out = []
    for entry in entries or []:
        card = entry.get("card") or {}
        code = card_map.get(card.get("_id"))
        if code is None:
            unresolved.append(card.get("name") or "?")
            continue
        out.extend([code] * max(1, int(entry.get("amount") or 1)))
    return out


def _deck_num(key):
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return DECK_NUM_BASE + (int(digest[:8], 16) & 0x3FFFFFFF)


def to_deck(raw, card_map):
    """Dal mazzo del sito al dict che si salva su database."""
    unresolved = []
    main = _zone(raw.get("main"), card_map, unresolved)
    extra = _zone(raw.get("extra"), card_map, unresolved)
    side = _zone(raw.get("side"), card_map, unresolved)
    if len(main) < 20:
        return None

    deck_type = _field(raw.get("deckType"), "name") or "Master Duel"
    # L'autore a volte e' un oggetto utente, a volte solo il suo nome.
    author = _field(raw.get("author"), "username")
    ranked = _field(raw.get("rankedType"), "name")
    tournament = raw.get("tournamentNumber") or None

    # Il sito non da' un titolo libero al mazzo: il nome utile e' quello
    # dell'archetipo, con accanto dove e' arrivato.
    label = deck_type
    if tournament:
        label += " - Torneo %s" % tournament
    elif ranked:
        label += " - %s" % ranked

    url = raw.get("url")
    return {
        "deck_num": _deck_num(str(raw.get("_id") or label + str(author))),
        "name": label,
        "author": author,
        "format": FORMAT_NAME,
        "main": main,
        "extra": extra,
        "side": side,
        "side_fetched": 1,
        "cover_card": main[0] if main else None,
        "views": 0,
        "price": None,
        "pretty_url": None,
        "excerpt": "Mazzo %s su Master Duel" % deck_type,
        "description": None,
        "tournament_name": ("Torneo %s" % tournament) if tournament else None,
        "tournament_place": ranked,
        "tournament_players": None,
        "submit_date": (raw.get("created") or "")[:10] or None,
        "source": "masterduel",
        "source_url": (SITE + url) if url else SITE,
        "unresolved": unresolved,
        # Il sito dichiara l'archetipo: e' piu' affidabile di dedurlo.
        "declared_archetype": deck_type,
    }
