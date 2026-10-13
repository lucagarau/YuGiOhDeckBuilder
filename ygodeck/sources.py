"""Recupero dei dati da internet (YGOPRODeck).

Endpoint usati, tutti pubblici e senza chiave:
  - db.ygoprodeck.com/api/v7/cardinfo.php       database completo delle carte
  - ygoprodeck.com/api/decks/getDecks.php       ricerca mazzi (20 per pagina)
  - ygoprodeck.com/api/autocompleteDeckArchetype.php   elenco archetipi
  - ygoprodeck.com/deck/<slug>                 pagina mazzo, da cui si estrae il side
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

CARDINFO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
DECKS_URL = "https://ygoprodeck.com/api/decks/getDecks.php"
ARCHETYPES_URL = "https://ygoprodeck.com/api/autocompleteDeckArchetype.php"
DECK_PAGE_URL = "https://ygoprodeck.com/deck/"
IMAGE_URL = "https://images.ygoprodeck.com/images/cards/{id}.jpg"
IMAGE_SMALL_URL = "https://images.ygoprodeck.com/images/cards_small/{id}.jpg"

USER_AGENT = "YuGiOhDeckBuilder/1.0 (local tool)"
PAGE_SIZE = 20

# Valori accettati da _sft_category, nell'ordine del menu del sito.
# Attenzione: il parametro vuole gli spazi, non gli slug con i trattini.
FORMATS = [
    "Tournament Meta Decks",
    "Tournament Meta Decks (Genesys)",
    "Tournament Meta Decks (Genesys OCG)",
    "Tournament Meta Decks OCG",
    "Tournament Meta Decks OCG (Asian-English)",
    "Tournament Meta Decks OCG (China)",
    "Tournament Meta Decks Worlds",
    "meta decks",
    "world championship decks",
    "non-meta decks",
    "anime decks",
    "fun/casual decks",
    "theorycrafting decks",
    "master duel decks",
    "common charity decks",
    "genesys decks",
    "domain format decks",
    "edison format decks",
    "goat format decks",
    "worlds format decks",
    "trinity format decks",
    "speed duel decks",
]


class SourceError(RuntimeError):
    pass


def _fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise SourceError("HTTP %s su %s" % (exc.code, url)) from exc
    except urllib.error.URLError as exc:
        raise SourceError(
            "Rete non raggiungibile (%s). Alcuni provider bloccano i domini "
            "Yu-Gi-Oh: prova con una VPN attiva." % exc.reason
        ) from exc


def _fetch_json(url, timeout=90):
    raw = _fetch(url, timeout=timeout)
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError as exc:
        raise SourceError("Risposta non JSON da %s" % url) from exc


# ------------------------------------------------------------------ carte

def fetch_all_cards():
    """Dump completo del database carte (circa 14.600 carte, ~21 MB)."""
    payload = _fetch_json(CARDINFO_URL, timeout=180)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not data:
        raise SourceError("Il database carte e' arrivato vuoto")
    return data


def fetch_card_names(language="it", timeout=180):
    """{passcode: (nome, effetto)} nella lingua richiesta.

    Stesso endpoint delle carte con il parametro `language`: i passcode
    non cambiano, quindi si innesta sul dump inglese per id.
    """
    payload = _fetch_json(CARDINFO_URL + "?language=" + language, timeout=timeout)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not data:
        raise SourceError("Le carte in %s sono arrivate vuote" % language)
    return {
        int(c["id"]): (c.get("name"), c.get("desc"))
        for c in data
        if c.get("id") is not None
    }


def fetch_archetypes():
    """Elenco degli archetipi noti al sito (circa 660 voci)."""
    payload = _fetch_json(ARCHETYPES_URL, timeout=60)
    suggestions = payload.get("suggestions", []) if isinstance(payload, dict) else []
    return [s["value"] for s in suggestions if s.get("value")]


# ------------------------------------------------------------------ mazzi

def fetch_deck_page(fmt=None, archetype=None, name=None, offset=0, sort=None):
    """Una pagina di risultati (max 20 mazzi). Lista vuota se non ci sono match."""
    params = []
    if name:
        params.append(("name", name))
    if fmt:
        params.append(("_sft_category", fmt))
    if archetype:
        params.append(("_sft_post_tag", archetype))
    if sort:
        params.append(("sort", sort))
    params.append(("offset", str(int(offset))))

    url = DECKS_URL + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    payload = _fetch_json(url, timeout=90)

    # Fine dei risultati: l'API risponde con {"error": "No decks matching..."}
    if isinstance(payload, dict):
        return []
    return payload if isinstance(payload, list) else []


SIDE_DECK_RE = re.compile(r"var\s+sidedeckjs\s*=\s*'(\[.*?\])'", re.S)


def fetch_side_deck(pretty_url):
    """Il side deck esiste solo nella pagina HTML del mazzo, non nell'API."""
    if not pretty_url:
        return []
    html = _fetch(DECK_PAGE_URL + urllib.parse.quote(pretty_url), timeout=60)
    match = SIDE_DECK_RE.search(html.decode("utf-8", "replace"))
    if not match:
        return []
    try:
        return [int(x) for x in json.loads(match.group(1))]
    except (ValueError, TypeError):
        return []


# -------------------------------------------------------------- normalizza

def _ids(raw):
    """main_deck/extra_deck arrivano come stringa JSON di passcode ripetuti."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    out = []
    for x in raw or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _float(raw):
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _int(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def normalize_archetype(text):
    """Forma confrontabile: minuscole e punteggiatura ridotta a spazi."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def build_name_index(archetype_names):
    """{forma normalizzata: nome originale} per il match sul titolo.

    Le sigle di una o due lettere ("C", "A.I.") darebbero falsi positivi
    dentro parole comuni, quindi restano fuori dall'indice.
    """
    index = {}
    for name in archetype_names or []:
        key = normalize_archetype(name)
        if len(key) >= 4:
            index.setdefault(key, name)
    return index


MAX_NGRAM = 6


def archetypes_in_title(title, name_index):
    """Archetipi citati nel titolo del mazzo, dal piu' specifico al generico.

    Confronta gli n-grammi del titolo con l'indice: il confine di parola e'
    garantito dalla tokenizzazione, senza bisogno di espressioni regolari.
    """
    if not name_index:
        return []
    words = normalize_archetype(title).split()
    found = []
    for size in range(min(MAX_NGRAM, len(words)), 0, -1):
        for start in range(len(words) - size + 1):
            gram = words[start : start + size]
            text = " ".join(gram)
            hit = name_index.get(text)
            if hit is None and gram[-1].endswith("s") and len(gram[-1]) > 3:
                # "Edison - Ojamas" cita l'archetipo "Ojama" al plurale.
                hit = name_index.get(" ".join(gram[:-1] + [gram[-1][:-1]]))
            if hit and hit not in found:
                found.append(hit)
    return found


def derive_archetypes(title, main_ids, extra_ids, arch_map, name_index=None,
                      max_count=3):
    """L'API non dice l'archetipo del mazzo: va dedotto.

    Due segnali imperfetti si correggono a vicenda. Il conteggio degli
    archetipi delle carte sovrastima le staple (ogni mazzo retro sembra
    "Greed" per via di Pot of Greed), mentre il titolo copre solo il 70% dei
    mazzi. Un archetipo citato nel titolo *e* presente tra le carte e' la
    prova piu' solida, quindi ha la precedenza; in mancanza serve un
    archetipo con una presenza consistente, altrimenti il mazzo non ne ha.
    """
    tally = {}
    for cid in list(main_ids) + list(extra_ids):
        arch = arch_map.get(cid)
        if arch:
            tally[arch] = tally.get(arch, 0) + 1

    titled = archetypes_in_title(title, name_index)
    confirmed = sorted(
        (a for a in titled if a in tally),
        key=lambda a: (-tally[a], a),
    )

    ranked = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))
    strong = [a for a, n in ranked if n >= 5]

    ordered = []
    for arch in confirmed + strong + titled:
        if arch not in ordered:
            ordered.append(arch)
    return ordered[:max_count]


def normalize_deck(raw, arch_map, name_index=None):
    """Dal dict dell'API al dict che si salva su database."""
    main_ids = _ids(raw.get("main_deck"))
    extra_ids = _ids(raw.get("extra_deck"))
    side_ids = _ids(raw.get("side_deck"))
    title = (raw.get("deck_name") or "").strip() or "Mazzo senza nome"
    archetypes = derive_archetypes(title, main_ids, extra_ids, arch_map, name_index)
    return {
        "deck_num": _int(raw.get("deckNum")),
        "name": title,
        "author": raw.get("username"),
        "format": raw.get("format") or "",
        "archetype": archetypes[0] if archetypes else "",
        "archetypes": archetypes,
        "main": main_ids,
        "extra": extra_ids,
        "side": side_ids,
        "cover_card": _int(raw.get("cover_card")),
        "views": _int(raw.get("deck_views")) or 0,
        "price": _float(raw.get("deck_price")),
        "pretty_url": raw.get("pretty_url"),
        "excerpt": raw.get("deck_excerpt"),
        "description": raw.get("deck_description"),
        "tournament_name": raw.get("tournamentName"),
        "tournament_place": raw.get("tournamentPlacement"),
        "tournament_players": _int(raw.get("tournamentPlayerCount")),
        "submit_date": raw.get("submit_date"),
    }
