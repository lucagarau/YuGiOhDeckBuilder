"""Generazione del file .ydk (formato YGOPro / EDOPro / Omega).

Struttura attesa dai client:

    #created by <autore>
    #main
    <passcode>        una riga per copia
    #extra
    <passcode>
    !side
    <passcode>
"""
import re

MAX_NAME = 80


def build(deck):
    """deck: il dict restituito da db.get_deck. Ritorna il testo del .ydk."""
    lines = ["#created by %s" % (deck.get("author") or "YuGiOhDeckBuilder")]

    name = deck.get("name")
    if name:
        lines.append("#%s" % name.replace("\n", " ").strip())

    lines.append("#main")
    lines += [str(c) for c in deck.get("main") or []]
    lines.append("#extra")
    lines += [str(c) for c in deck.get("extra") or []]
    lines.append("!side")
    lines += [str(c) for c in deck.get("side") or []]

    # I client si aspettano le terminazioni Windows e una riga finale vuota.
    return "\r\n".join(lines) + "\r\n"


def filename(deck):
    """Nome file sicuro su qualsiasi filesystem."""
    base = (deck.get("name") or "deck").strip()
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", base)
    base = re.sub(r"\s+", " ", base).strip(" .")
    base = base[:MAX_NAME] or "deck"
    return "%s - %s.ydk" % (base, deck.get("deck_num"))
