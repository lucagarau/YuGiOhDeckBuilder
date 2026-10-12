"""Mazzi dei giochi Yu-Gi-Oh! Tag Force, dal wiki Fandom.

La saga PSP (Tag Force 1-6 e ARC-V Tag Force Special) non e' su YGOPRODeck:
i mazzi dei personaggi sono pero' documentati sul wiki dentro template
{{Decklist}}, che hanno una struttura regolare e quindi si possono leggere.

Due tipi di pagina:
  - pagine personaggio "<Nome> (Tag Force)", con una sezione "Decks" divisa
    per gioco: coprono soprattutto Tag Force 3-6 e Special;
  - pagine "<Gioco>: Character Deck Recipes", che raccolgono i mazzi di
    Tag Force 1 e 2 in un elenco unico.

Il wiki indica le carte per nome, non per passcode: la conversione passa
dal database carte locale. Circa il 2-3% dei nomi non si risolve perche'
sono carte mai uscite fuori dall'OCG o esclusive dei videogiochi; quei
mazzi restano consultabili, con l'elenco di cosa manca.
"""
import hashlib
import json
import re
import urllib.parse
import urllib.request

API = "https://yugioh.fandom.com/api.php"
PAGE_URL = "https://yugioh.fandom.com/wiki/"
USER_AGENT = "YuGiOhDeckBuilder/1.1 (local tool)"

# Intervallo riservato ai mazzi che non vengono da YGOPRODeck, cosi' i
# numeri non possono collidere con i suoi (arrivati a ~740.000).
DECK_NUM_BASE = 1_000_000_000

GAMES = [
    "Tag Force 1", "Tag Force 2", "Tag Force 3", "Tag Force 4",
    "Tag Force 5", "Tag Force 6", "Tag Force Special",
]

CHARACTER_CATEGORIES = {
    "Category:Yu-Gi-Oh! GX Tag Force characters": "Tag Force 1",
    "Category:Yu-Gi-Oh! GX Tag Force 2 characters": "Tag Force 2",
    "Category:Yu-Gi-Oh! GX Tag Force 3 characters": "Tag Force 3",
    "Category:Yu-Gi-Oh! 5D's Tag Force 4 characters": "Tag Force 4",
    "Category:Yu-Gi-Oh! 5D's Tag Force 5 characters": "Tag Force 5",
    "Category:Yu-Gi-Oh! 5D's Tag Force 6 characters": "Tag Force 6",
    "Category:Yu-Gi-Oh! ARC-V Tag Force Special characters": "Tag Force Special",
}

RECIPE_PAGES = {
    "Yu-Gi-Oh! GX Tag Force: Character Deck Recipes": "Tag Force 1",
    "Yu-Gi-Oh! GX Tag Force 2: Character Deck Recipes": "Tag Force 2",
}

BATCH = 50

# Sotto questa soglia il mazzo non e' piu' giocabile ne' rappresentativo.
MIN_MAIN = 20


class TagForceError(RuntimeError):
    pass


def _api(params, timeout=90):
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:
        raise TagForceError("wiki non raggiungibile: %s" % exc) from exc


# ------------------------------------------------------------- recupero

def fetch_character_pages():
    """{titolo pagina: set dei giochi in cui compare il personaggio}."""
    pages = {}
    for category, game in CHARACTER_CATEGORIES.items():
        cont = None
        while True:
            params = {
                "action": "query", "list": "categorymembers",
                "cmtitle": category, "cmlimit": "500",
            }
            if cont:
                params["cmcontinue"] = cont
            data = _api(params)
            for item in data.get("query", {}).get("categorymembers", []):
                pages.setdefault(item["title"], set()).add(game)
            cont = data.get("continue", {}).get("cmcontinue")
            if not cont:
                break
    return pages


def fetch_wikitext(titles):
    """{titolo: wikitext} per un blocco di pagine (max BATCH per richiesta)."""
    out = {}
    titles = list(titles)
    for i in range(0, len(titles), BATCH):
        chunk = titles[i : i + BATCH]
        data = _api({
            "action": "query", "prop": "revisions", "rvprop": "content",
            "rvslots": "main", "titles": "|".join(chunk),
        })
        for page in data.get("query", {}).get("pages", []):
            revisions = page.get("revisions")
            if not revisions:
                continue
            try:
                out[page["title"]] = revisions[0]["slots"]["main"]["content"]
            except (KeyError, IndexError):
                continue
    return out


# -------------------------------------------------------------- parsing

EXTRA_SECTIONS = {
    "fusion monsters", "synchro monsters", "xyz monsters", "link monsters",
}
SIDE_SECTIONS = {"side deck", "side"}

HEADING = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$", re.M)
GAME_RE = re.compile(r"tag force\s*(\d|special)?", re.I)
CARD_RE = re.compile(r"\*\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*(?:[xX]\s*(\d+))?")
CHARACTER_RE = re.compile(r"''\s*\d+\s*[–—-]\s*([^']+?)\s*''")


def find_templates(text, name="Decklist"):
    """Blocchi {{Nome ...}}, con parentesi bilanciate (possono annidarsi)."""
    out = []
    needle = "{{" + name
    i = 0
    while True:
        start = text.find(needle, i)
        if start < 0:
            return out
        depth, j = 0, start
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        body = text[start + 2 : j - 2]
        if body.startswith(name):
            body = body[len(name):].lstrip("|")
        out.append((start, body))
        i = j


def split_params(body):
    """Divide sui | di primo livello, saltando [[...]] e {{...}}."""
    parts, buf = [], []
    square = curly = 0
    k = 0
    while k < len(body):
        if body.startswith("[[", k):
            square += 1; buf.append("[["); k += 2; continue
        if body.startswith("]]", k):
            square -= 1; buf.append("]]"); k += 2; continue
        if body.startswith("{{", k):
            curly += 1; buf.append("{{"); k += 2; continue
        if body.startswith("}}", k):
            curly -= 1; buf.append("}}"); k += 2; continue
        if body[k] == "|" and square <= 0 and curly <= 0:
            parts.append("".join(buf)); buf = []; k += 1; continue
        buf.append(body[k]); k += 1
    parts.append("".join(buf))
    return parts


REPEAT_RE = re.compile(r"\{\{\s*Repeat\s*\|[^|}]*\|\s*(\d+)\s*\}\}", re.I)


def clean_text(raw):
    raw = re.sub(r"<[^>]+>", " ", raw or "")
    # Le stelline di difficolta' sono un template che ripete un'icona:
    # tenerle come numero e' piu' utile che buttarle.
    raw = REPEAT_RE.sub(lambda m: "★" + m.group(1), raw)
    raw = re.sub(r"\{\{[^{}]*\}\}", " ", raw)
    raw = re.sub(
        r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]",
        lambda m: m.group(2) or m.group(1),
        raw,
    )
    raw = raw.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", raw).strip()


def normalize_game(raw):
    match = re.match(r"tag force\s*(\d|special)?", (raw or "").strip().lower())
    if not match:
        return None
    number = match.group(1)
    if number is None:
        return "Tag Force 1"
    if number == "special":
        return "Tag Force Special"
    return "Tag Force " + number


def _deck_sections(text):
    """[(posizione, gioco)] e numero di sottosezioni dentro "Decks".

    Le pagine personaggio elencano i mazzi di piu' giochi sotto la stessa
    sezione: "Nightmare Troubadour", "Spirit Caller", "Tag Force 5"... Una
    sottosezione che non nomina Tag Force azzera il gioco corrente, cosi' i
    mazzi degli altri titoli non finiscono per sbaglio fra questi.
    """
    marks, in_decks = [], False
    for match in HEADING.finditer(text):
        level = len(match.group(1))
        plain = clean_text(match.group(2)).lower()
        if level == 2:
            in_decks = plain.startswith("deck")
            if in_decks:
                marks.append((match.end(), "decks", None))
            continue
        if in_decks:
            found = GAME_RE.search(plain)
            marks.append((
                match.end(), "sub",
                normalize_game(found.group(0)) if found else None,
            ))
    return marks


def _game_at(marks, pos, default):
    """Il gioco e' quello dichiarato dall'ultima sottosezione aperta.

    Senza sottosezioni vale il default (il gioco del personaggio). Appena
    ce n'e' una, decide lei: se non nomina Tag Force il gioco resta ignoto
    e il mazzo viene scartato, perche' appartiene a un altro titolo.
    """
    current = default
    for start, kind, game in marks:
        if start > pos:
            break
        current = default if kind == "decks" else game
    return current


SIDE_TITLE_RE = re.compile(r"^(.*?)\s*[-–—]\s*side\s*deck\s*$", re.I)


def _attach_side(decks, title, cards):
    """Il wiki mette i side deck in un {{Decklist}} a parte.

    "Back to Basics 1 - Side Deck" e' il side di "Back to Basics 1", non un
    mazzo da 15 carte: va riagganciato, altrimenti sporca l'archivio.
    """
    match = SIDE_TITLE_RE.match(title or "")
    if not match:
        return False
    parent = match.group(1).strip().lower()
    for deck in reversed(decks):
        if deck["title"].strip().lower() == parent:
            deck["side"].extend(cards)
            return True
    return True  # senza mazzo padre resta comunque da scartare


def parse_page(text, default_game=None):
    """Mazzi trovati in una pagina del wiki."""
    marks = _deck_sections(text)
    decks = []
    for pos, body in find_templates(text):
        params = split_params(body)
        if not params:
            continue
        raw_title = params[0]
        character = CHARACTER_RE.search(raw_title)
        title = clean_text(re.split(r"<br\s*/?>", raw_title, 1)[0])

        main, extra, side = [], [], []
        for param in params[1:]:
            if "=" not in param:
                continue
            key, _, value = param.partition("=")
            key = key.strip().lower()
            cards = [
                (name.strip(), int(qty) if qty else 1)
                for name, qty in CARD_RE.findall(value)
                if name.strip()
            ]
            if not cards:
                continue
            if key in EXTRA_SECTIONS:
                extra.extend(cards)
            elif key in SIDE_SECTIONS:
                side.extend(cards)
            else:
                main.extend(cards)

        if not main:
            continue
        if _attach_side(decks, title, main + side):
            continue

        game = _game_at(marks, pos, default_game)
        if not game:
            continue  # sezione di un altro gioco, non di Tag Force
        decks.append({
            "title": title or "Mazzo senza nome",
            "character": clean_text(character.group(1)) if character else None,
            "game": game,
            "main": main, "extra": extra, "side": side,
        })
    return decks


# ------------------------------------------------------- normalizzazione

def normalize_card_name(name):
    """Il wiki aggiunge suffissi di disambiguazione che il DB non ha."""
    name = re.sub(r"\s*\((?:card|trap|spell|monster)\)\s*$", "", name, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def build_name_index(rows):
    """{nome normalizzato: passcode}, dal database carte locale."""
    index = {}
    for row in rows:
        index.setdefault(normalize_card_name(row["name"]), row["id"])
    return index


def _deck_num(key):
    """Numero stabile e ripetibile, cosi' riaggiornare non duplica i mazzi."""
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return DECK_NUM_BASE + (int(digest[:8], 16) & 0x3FFFFFFF)


def _expand(entries, index, unresolved):
    out = []
    for name, qty in entries:
        card_id = index.get(normalize_card_name(name))
        if card_id is None:
            unresolved.append(name)
            continue
        out.extend([card_id] * max(1, qty))
    return out


def to_deck(parsed, page_title, index):
    """Dal mazzo letto dal wiki al dict che si salva su database."""
    unresolved = []
    main = _expand(parsed["main"], index, unresolved)
    extra = _expand(parsed["extra"], index, unresolved)
    side = _expand(parsed["side"], index, unresolved)

    # Alcuni mazzi (Meklord, Yliaster) sono quasi tutti di carte mai uscite
    # dall'OCG: ne resterebbe un moncone inutilizzabile, meglio scartarli.
    if len(main) < MIN_MAIN or len(unresolved) > len(main):
        return None

    game = parsed["game"] or "Tag Force"
    character = parsed["character"] or re.sub(
        r"\s*\(Tag Force\)\s*$", "", page_title
    ).strip()
    key = "%s|%s|%s" % (game, character, parsed["title"])

    return {
        "deck_num": _deck_num(key),
        "name": parsed["title"],
        "author": character or None,
        "format": game,
        "main": main,
        "extra": extra,
        "side": side,
        "side_fetched": 1,          # non c'e' nulla da recuperare altrove
        "cover_card": main[0] if main else None,
        "views": 0,
        "price": None,
        "pretty_url": None,
        "excerpt": "Mazzo di %s in %s" % (character, game) if character else game,
        "description": None,
        "tournament_name": None,
        "tournament_place": None,
        "tournament_players": None,
        "submit_date": None,
        "source": "tagforce",
        "source_url": PAGE_URL + urllib.parse.quote(page_title.replace(" ", "_")),
        "unresolved": unresolved,
    }
