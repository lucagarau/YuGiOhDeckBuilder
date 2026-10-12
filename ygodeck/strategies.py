"""Riconoscimento del funzionamento del mazzo (burn, stun, chaos, ...).

Come per gli archetipi, la sorgente non espone questo dato. Il titolo lo
dichiara solo nel 6% dei casi, quindi il segnale principale sono le carte:
ogni strategia si riconosce da carte firma, da schemi nel testo delle carte
e dalla composizione del mazzo.

Le soglie sono tarate sui mazzi che dichiarano la strategia nel titolo: un
vero mazzo burn ha 10-22 carte che infliggono danno su 40, mentre
"Burning Abyss", che burn non e', ne ha una sola.
"""
import re

# ------------------------------------------------------------------ regole
#
# Ogni regola produce un punteggio; la strategia vale se raggiunge "soglia".
#   cards       : carte firma, per nome esatto (minuscolo)
#   testo       : schema cercato nel testo delle carte del main deck
#   titolo      : parole che, nel nome del mazzo, confermano la strategia
#   peso_titolo : quanto vale il titolo (default: meta' soglia, cioe'
#                 conferma ma non decide). Serve alzarlo solo per le
#                 strategie che il mazzo non rivela nelle carte.

RULES = [
    {
        "key": "burn",
        "label": "Burn (danno diretto)",
        "soglia": 7,
        "testo": r"inflict \d+ damage|inflict damage|damage to your opponent"
                 r"|takes? \d+ damage",
        "titolo": ["burn"],
    },
    {
        "key": "stall",
        "label": "Stall (difensivo)",
        "soglia": 4,
        "cards": [
            "swords of revealing light", "messenger of peace", "gravity bind",
            "level limit - area b", "threatening roar", "waboku", "scapegoat",
            "battle fader", "marshmallon", "spirit reaper", "nimble momonga",
            "dimension wall", "negate attack", "magical hats", "wall of revealing light",
        ],
        "titolo": ["stall", "lockdown"],
    },
    {
        "key": "stun",
        "label": "Stun / Floodgate",
        "soglia": 4,
        "cards": [
            "skill drain", "vanity's emptiness", "macro cosmos", "dimensional fissure",
            "rivalry of warlords", "gozen match", "there can be only one",
            "anti-spell fragrance", "mask of restrict", "summon limit",
            "imperial order", "royal decree", "light-imprisoning mirror",
            "shadow-imprisoning mirror", "dimensional barrier", "non-spellcasting area",
            "jowgen the spiritualist", "fossil dyna pachycephalo", "inspector boarder",
            "archlord kristya", "vanity's fiend", "vanity's ruler", "majesty's fiend",
            "thunder king rai-oh", "king tiger wanghu", "mistake", "fusion tag",
            "barrier statue of the stormwinds", "barrier statue of the heavens",
            "barrier statue of the abyss", "barrier statue of the drought",
            "barrier statue of the torrent", "barrier statue of the inferno",
            "droll & lock bird", "eradicator epidemic virus", "deck devastation virus",
        ],
        "titolo": ["stun", "floodgate"],
    },
    {
        "key": "chaos",
        "label": "Chaos (Luce/Oscurita')",
        "soglia": 2,
        "cards": [
            "black luster soldier - envoy of the beginning",
            "chaos emperor dragon - envoy of the end",
            "chaos sorcerer", "dark armed dragon", "chaos valkyria",
            "chaos hunter", "chaos daedalus", "chaos end", "chaos greed",
            "black luster soldier - super soldier", "dark magician of chaos",
            "envoy of the beginning", "sillva, warlord of dark world",
            # Il "chaos" moderno passa da queste, non piu' dagli Envoy.
            "chaos angel", "chaos ruler, the chaotic magical dragon",
            "chaos dragon levianeer", "chaos space", "chaos valkyria",
            "the chaos creator", "chaos summoning beast",
            "dark grepher", "necro gardna", "gren maju da eiza",
        ],
        "archetipi": ["Chaos"],
        "titolo": ["chaos"],
    },
    {
        "key": "otk",
        "label": "OTK / FTK (vittoria immediata)",
        "soglia": 2,
        # Un FTK moderno non ha carte firma: e' una linea di combo che
        # vince al primo turno. Quando l'autore lo dichiara nel titolo,
        # quella e' l'informazione migliore disponibile.
        "peso_titolo": 2,
        "titolo": ["otk", "ftk", "one turn kill", "first turn kill"],
        "cards": [
            "limiter removal", "chain strike", "cyber-stein",
            "magical mallet", "card of demise", "upstart goblin",
            "toy vendor", "heart of the underdog",
        ],
    },
    {
        "key": "monarca",
        "label": "Monarca (Tributo)",
        "soglia": 4,
        "archetipi": ["Monarch"],
        "cards": [
            "domain of the true monarchs", "pantheism of the monarchs",
            "the monarchs stormforth", "the prime monarch", "tenacity of the monarchs",
            "escalation of the monarchs", "march of the monarchs",
            "treeborn frog", "battle fader", "mobius the frost monarch",
            "caius the shadow monarch", "raiza the storm monarch",
            "thestalos the firestorm monarch", "granmarg the rock monarch",
            "zaborg the thunder monarch", "kuraz the light monarch",
            "vanity's fiend", "soul exchange", "enemy controller",
        ],
        "titolo": ["monarch", "monarca"],
    },
    {
        "key": "exodia",
        "label": "Exodia / FTK",
        "soglia": 3,
        "cards": [
            "exodia the forbidden one", "right leg of the forbidden one",
            "left leg of the forbidden one", "right arm of the forbidden one",
            "left arm of the forbidden one", "exodius the ultimate forbidden lord",
            "last turn", "final countdown", "destiny board", "spirit message i",
            "spirit message n", "spirit message a", "spirit message l",
        ],
        "titolo": ["exodia", "countdown", "last turn"],
    },
    {
        "key": "mill",
        "label": "Mill / Deck Out",
        "soglia": 4,
        "cards": [
            "needle worm", "morphing jar", "cards of safe return", "that grass looks greener",
            "reasoning", "monster gate", "lawnmowing", "dark world dealings",
            "card destruction", "hidden book of spell", "mass driver",
            "respect play", "appropriate", "the transmigration prophecy",
        ],
        "testo": r"send the top \d+ cards? (?:of|from) (?:your|their|the) "
                 r"(?:opponent's )?deck to the (?:gy|graveyard)",
        "titolo": ["mill", "deck out", "deckout"],
    },
]

# Le strategie strutturali non hanno carte firma: si leggono dalla forma del
# mazzo (quante trappole, quanto e' pieno l'extra deck).
STRUCTURAL = {
    "control": "Control (trappole)",
    "combo": "Combo (Extra Deck)",
    "aggro": "Aggro / Beatdown",
}

LABELS = {r["key"]: r["label"] for r in RULES}
LABELS.update(STRUCTURAL)
ALL_KEYS = [r["key"] for r in RULES] + list(STRUCTURAL)


def _norm(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


class Tagger:
    """Prepara gli indici una volta sola e poi etichetta i mazzi in serie."""

    def __init__(self, card_index):
        """card_index: {passcode: dict carta} con name, descr, type, archetype."""
        self.cards = card_index
        by_name = {}
        for cid, card in card_index.items():
            by_name.setdefault(_norm(card.get("name")), []).append(cid)

        self.rules = []
        for rule in RULES:
            signature = set()
            for name in rule.get("cards", []):
                signature.update(by_name.get(_norm(name), []))
            self.rules.append({
                "key": rule["key"],
                "soglia": rule["soglia"],
                "signature": signature,
                "testo": re.compile(rule["testo"]) if rule.get("testo") else None,
                "archetipi": set(rule.get("archetipi", [])),
                "titolo": rule.get("titolo", []),
                "peso_titolo": rule.get("peso_titolo", max(1, rule["soglia"] // 2)),
            })

    def _title_hits(self, title, words):
        low = " " + _norm(title) + " "
        return any(
            re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low) for w in words
        )

    def tag(self, title, main_ids, extra_ids, max_count=3):
        """Ritorna la lista delle strategie del mazzo, dalla piu' forte."""
        main = [self.cards.get(c) for c in main_ids]
        main = [c for c in main if c]
        if not main:
            return []

        traps = sum(1 for c in main if "trap" in (c.get("type") or "").lower())
        spells = sum(1 for c in main if "spell" in (c.get("type") or "").lower())

        scored = []
        for rule in self.rules:
            score = sum(1 for c in main_ids if c in rule["signature"])
            if rule["testo"]:
                score += sum(
                    1 for c in main
                    if c.get("descr") and rule["testo"].search(c["descr"].lower())
                )
            if rule["archetipi"]:
                score += sum(1 for c in main if c.get("archetype") in rule["archetipi"])

            # Il titolo conferma, non decide: vale meta' soglia, cosi' da solo
            # non basta ma fa passare i mazzi appena sotto la soglia.
            if rule["titolo"] and self._title_hits(title, rule["titolo"]):
                score += rule["peso_titolo"]

            if score >= rule["soglia"]:
                scored.append((score / rule["soglia"], rule["key"]))

        scored.sort(key=lambda item: (-item[0], item[1]))
        keys = [key for _, key in scored][:max_count]

        if not keys:
            keys = [self._structural(traps, spells, len(main), len(extra_ids))]
        return keys

    def _structural(self, traps, spells, main_size, extra_size):
        """Senza carte firma resta la forma del mazzo."""
        if traps >= 12:
            return "control"
        if extra_size >= 13:
            return "combo"
        if traps + spells <= 14:
            return "aggro"
        return "combo" if extra_size >= 8 else "control"


def build_card_index(rows):
    """rows: iterabile di dict carta (id, name, descr, type, archetype)."""
    return {r["id"]: r for r in rows}
