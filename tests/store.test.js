/**
 * Test di web/store.js, il modulo condiviso dalle due versioni dell'app.
 *
 *     node tests/store.test.js
 *
 * Serve l'archivio esportato (data/export/), quindi prima:
 *
 *     python app.py --export
 *
 * Carica lo store vero, non una copia della sua logica: un test che
 * riscrive le regole che dovrebbe verificare non verifica niente.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data", "export");

// Lo store usa queste solo dentro load(), che qui non chiamiamo.
global.fetch = () => Promise.reject(new Error("non usato nei test"));
global.Image = function () {};
global.localStorage = (() => {
  let box = {};
  return {
    getItem: (k) => (k in box ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; },
  };
})();

if (!fs.existsSync(path.join(DATA, "cards.json"))) {
  console.error("Manca data/export/. Esegui prima: python app.py --export");
  process.exit(2);
}

const Store = eval(
  fs.readFileSync(path.join(ROOT, "web", "store.js"), "utf8") + ";Store"
);
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
const cards = read("cards.json");
const decks = read("decks.json");
const meta = read("meta.json");
Store.__inject(cards, decks, meta);

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FALLITO  ${name}${detail ? " -> " + detail : ""}`);
  }
}

// Passcode noti, scelti per coprire ogni famiglia di carta.
const DARK_MAGICIAN = 46986414;
const ACCESSCODE = 86066372;      // Link
const AA_ZEUS = 90448279;         // Xyz
const ODD_EYES = 16178681;        // Pendulum

// --------------------------------------------------- zone delle carte

check("un Link va nell'Extra", Store.zoneFor(ACCESSCODE) === "extra");
check("un Xyz va nell'Extra", Store.zoneFor(AA_ZEUS) === "extra");
check("un mostro normale va nel Main", Store.zoneFor(DARK_MAGICIAN) === "main");
check("un Pendulum va nel Main", Store.zoneFor(ODD_EYES) === "main");

// ------------------------------------------------------- file .ydk

const sample = decks.find((d) => d.side && d.side.length && d.extra.length);
const roundTrip = Store.parseYdk(Store.buildYdk(sample));
check(
  "scrivere e rileggere un .ydk non cambia le carte",
  JSON.stringify([roundTrip.main, roundTrip.extra, roundTrip.side]) ===
    JSON.stringify([sample.main, sample.extra, sample.side])
);
check("il .ydk conserva il nome", roundTrip.name === sample.name, roundTrip.name);

const messy = Store.parseYdk(
  ["#created by Tizio", "#Prova", "#main", "46986414", "", "#extra",
   "86066372", "!side", "16178681", "riga che non c'entra"].join("\n")
);
check("le righe non valide vengono ignorate",
  messy.main.length === 1 && messy.extra.length === 1 && messy.side.length === 1);
check("legge l'autore", messy.author === "Tizio", messy.author);

// --------------------------------------------------------- validazione

check("un mazzo dell'archivio e' valido", Store.validateDeck(sample).ok,
  Store.validateDeck(sample).errors.join(" | "));

const tooMany = Store.validateDeck({
  main: Array(40).fill(DARK_MAGICIAN), extra: [], side: [],
});
check("piu' di tre copie e' un errore",
  tooMany.errors.some((e) => e.includes("massimo e' 3")));

const tooSmall = Store.validateDeck({ main: sample.main.slice(0, 30), extra: [], side: [] });
check("meno di 40 carte nel Main e' un errore",
  tooSmall.errors.some((e) => e.includes("minimo")));

const wrongZone = Store.validateDeck({
  main: [ACCESSCODE, ...sample.main.slice(0, 39)], extra: [], side: [],
});
check("un Link nel Main e' un errore",
  wrongZone.errors.some((e) => e.includes("Extra Deck")));

// Le tre copie si contano sul passcode canonico: tre artwork diversi
// della stessa carta sono comunque tre copie.
const aliasPair = Object.entries(meta.aliases || {})[0];
if (aliasPair) {
  const aliasId = Number(aliasPair[0]);
  const realId = aliasPair[1];
  check("gli artwork alternativi contano come la carta vera",
    Store.copiesOf({ main: [aliasId, realId, realId], extra: [], side: [] }, realId) === 3);
  const mixed = Store.validateDeck({
    main: [aliasId, realId, realId, aliasId, ...Array(36).fill(DARK_MAGICIAN)],
    extra: [], side: [],
  });
  check("quattro copie fra artwork diversi sono un errore",
    mixed.errors.some((e) => e.includes("massimo e' 3")));
}

// ------------------------------------------------------------ tidyDeck

const { deck: tidied, moved } = Store.tidyDeck({
  main: [ACCESSCODE, DARK_MAGICIAN], extra: [DARK_MAGICIAN], side: [],
});
check("tidyDeck rimette le carte nella zona giusta",
  tidied.extra.includes(ACCESSCODE) && tidied.main.includes(DARK_MAGICIAN) &&
  moved.length === 2);

// --------------------------------------------------- mazzi salvati

const saved = Store.saveDeck({ name: "Prova", main: sample.main, extra: [], side: [] });
check("salva un mazzo", saved && Store.savedDecks().length === 1);
Store.saveDeck(Object.assign({}, saved, { name: "Rinominato" }));
check("risalvare aggiorna invece di duplicare",
  Store.savedDecks().length === 1 && Store.savedDecks()[0].name === "Rinominato");
Store.deleteSavedDeck(saved.id);
check("elimina un mazzo", Store.savedDecks().length === 0);

// --------------------------------------- ricerca e conteggi sui mazzi

const byCard = Store.decksWithCard(DARK_MAGICIAN);
const expected = decks.filter((d) =>
  ["main", "extra", "side"].some((z) =>
    (d[z] || []).some((id) => (meta.aliases[id] || id) === DARK_MAGICIAN))
).length;
check("il conteggio dei mazzi con una carta e' esatto",
  byCard.length === expected, `${byCard.length} invece di ${expected}`);

const filtered = Store.search({ cardId: DARK_MAGICIAN, perPage: 96 });
check("il filtro per carta trova gli stessi mazzi", filtered.total === expected);

// ---------------------------------------------------- liste di divieti

const POT_OF_GREED = 55144522;
check("Pot of Greed e' vietata nel TCG", Store.banLimit(POT_OF_GREED, "tcg") === 0);
check("ma e' limitata nel Goat", Store.banLimit(POT_OF_GREED, "goat") === 1,
  String(Store.banLimit(POT_OF_GREED, "goat")));
check("senza formato vale il limite generale", Store.banLimit(POT_OF_GREED, null) === 3);
check("una carta fuori lista resta a tre copie", Store.banLimit(DARK_MAGICIAN, "tcg") === 3);

const withBanned = { main: [POT_OF_GREED, POT_OF_GREED], extra: [], side: [] };
check("una carta vietata e' un errore nel TCG",
  Store.validateDeck(withBanned, "tcg").errors.some((e) => e.indexOf("Vietata") >= 0));
check("due copie sono troppe anche nel Goat, dove e' limitata",
  Store.banIssues(withBanned, "goat")[0].limit === 1);
check("una copia sola invece passa nel Goat",
  Store.banIssues({ main: [POT_OF_GREED], extra: [], side: [] }, "goat").length === 0);
check("senza formato non si controlla la lista",
  !Store.validateDeck(withBanned).errors.some((e) => e.indexOf("Vietata") >= 0));
check("banIssues elenca il problema", Store.banIssues(withBanned, "tcg").length === 1);
check("un mazzo Goat sceglie la lista Goat",
  Store.formatOf({ format: "Goat Format Decks" }) === "goat");
check("un mazzo Tag Force non ha lista", Store.formatOf({ format: "Tag Force 3" }) === null);
// Master Duel ha una lista propria che la fonte non pubblica: applicargli
// quella del TCG darebbe un verdetto sbagliato.
check("un mazzo Master Duel non ha lista",
  Store.formatOf({ format: "Master Duel Meta" }) === null);

// --------------------------------------------------------------- lingua

Store.setLanguage("it");
check("i nomi sono in italiano",
  Store.cardName(Store.card(DARK_MAGICIAN)) === "Mago Nero",
  Store.cardName(Store.card(DARK_MAGICIAN)));
Store.setLanguage("en");
check("in inglese torna l'originale",
  Store.cardName(Store.card(DARK_MAGICIAN)) === "Dark Magician");
Store.setLanguage("it");
check("la ricerca trova il nome inglese anche in italiano",
  Store.searchCards({ q: "Dark Magician", perPage: 96 }).total > 0);
check("e trova anche il nome italiano",
  Store.searchCards({ q: "Mago Nero", perPage: 96 }).total > 0);

// ----------------------------------------------------------- ydke e link

const ydke = Store.buildYdke(sample);
check("lo ydke comincia come deve", ydke.indexOf("ydke://") === 0);
const fromYdke = Store.parseYdke(ydke);
check("lo ydke rifatto ha le stesse carte",
  JSON.stringify([fromYdke.main, fromYdke.extra, fromYdke.side]) ===
    JSON.stringify([sample.main, sample.extra, sample.side]));
check("uno ydke malformato non esplode", Store.parseYdke("non uno ydke") === null);

const hash = Store.deckToHash({
  name: "Prova & test", main: sample.main, extra: sample.extra, side: sample.side,
});
const hashValue = hash.replace(/^#mazzo=/, "").split("&")[0];
check("il link non contiene caratteri da sfuggire", !/[+/=]/.test(hashValue), hashValue.slice(0, 40));
const fromHash = Store.deckFromHash(hash);
check("il mazzo dal link e' identico",
  JSON.stringify([fromHash.main, fromHash.extra, fromHash.side]) ===
    JSON.stringify([sample.main, sample.extra, sample.side]));
check("il link conserva il nome", fromHash.name === "Prova & test", fromHash.name);
check("un link senza mazzo torna nullo", Store.deckFromHash("#altro=1") === null);

// -------------------------------------------------------- statistiche

const stats = Store.deckStats(sample);
check("le statistiche contano tutte le carte del main",
  stats.groups.Mostri + stats.groups.Magie + stats.groups.Trappole === sample.main.length,
  stats.groups.Mostri + "+" + stats.groups.Magie + "+" + stats.groups.Trappole +
    " invece di " + sample.main.length);
check("le probabilita' stanno fra 0 e 1",
  stats.opening.every((o) => o.chance >= 0 && o.chance <= 1));

// Tre copie su quaranta carte, cinque pescate: valore noto, 33,76%.
const known = Store.atLeast(40, 3, 5, 1);
check("il calcolo ipergeometrico e' corretto",
  Math.abs(known - 0.337579) < 0.0005, known.toFixed(6));
check("una copia sola si apre di rado",
  Store.atLeast(40, 1, 5, 1) > 0.12 && Store.atLeast(40, 1, 5, 1) < 0.13);
check("un mazzo di sole copie uguali da' certezza", Store.atLeast(40, 40, 5, 1) === 1);

// --------------------------------------------- sinergie e mazzi simili

const BLACK_LUSTER = 72989439;
const suggestions = Store.suggestCards([BLACK_LUSTER]);
check("i suggerimenti arrivano", suggestions.length > 0);
check("non ripetono la carta di partenza",
  !suggestions.some((x) => x.id === BLACK_LUSTER));
check("non sono solo staple",
  !suggestions.slice(0, 3).some((x) => /Heavy Storm|Mystical Space Typhoon|Ciclone/.test(x.name)),
  suggestions.slice(0, 3).map((x) => x.name).join(", "));
check("una carta inesistente non da' suggerimenti",
  Store.suggestCards([999999999]).length === 0);

const similar = Store.similarDecks(sample);
check("i mazzi simili arrivano", similar.length > 0);
check("non propone il mazzo stesso",
  !similar.some((x) => x.deck.deck_num === sample.deck_num));
check("sono ordinati per somiglianza",
  similar.every((x, i) => i === 0 || similar[i - 1].score >= x.score));

// -------------------------------------------------------- archetipi

const profile = Store.archetypeProfile("Blue-Eyes");
check("il profilo di un archetipo esiste", !!profile);
check("conta le sue carte", profile.cardCount > 10);
check("conta i suoi mazzi", profile.deckCount > 0);
check("sa dove si gioca", profile.formats.length > 0);
check("elenca le carte dalla piu' giocata",
  profile.cards.every((c, i) => i === 0 || profile.cards[i - 1].inArchetype >= c.inArchetype));
check("non si accosta a se stesso",
  !profile.partners.some((p) => p.key === "Blue-Eyes"));
check("un archetipo inventato non ha profilo",
  Store.archetypeProfile("Archetipo Inesistente") === null);
check("senza nome non ha profilo", Store.archetypeProfile("") === null);
check("l'elenco degli archetipi e' ordinato per numero di mazzi",
  Store.archetypeList().every((a, i) => i === 0 || Store.archetypeList()[i - 1].count >= a.count));

// ------------------------------------------------ mazzi da Master Duel

const mdDecks = decks.filter((d) => d.source === "masterduel");
if (mdDecks.length) {
  check("i mazzi Master Duel hanno un formato proprio",
    mdDecks.every((d) => d.format === "Master Duel Meta"));
  check("i loro numeri non collidono con le altre fonti",
    mdDecks.every((d) => d.deck_num >= 2000000000));
  // Qualche carta del sito non ha un passcode (una su 4.800 mazzi alla
  // scrittura di questo test): e' una lacuna della fonte, non del codice.
  // Si verifica che resti un'eccezione, non che non esista.
  const conLacune = mdDecks.filter((d) => (d.unresolved || []).length).length;
  check("le carte non riconosciute restano un'eccezione",
    conLacune / mdDecks.length < 0.005,
    `${conLacune} mazzi su ${mdDecks.length}`);
  check("hanno un main deck giocabile",
    mdDecks.every((d) => d.main.length >= 20));
  const risolte = mdDecks[0].main.every((id) => !!Store.card(id));
  check("i passcode di Master Duel esistono nel database carte", risolte);
}

console.log(`\n${passed} test superati, ${failed} falliti.`);
process.exit(failed ? 1 : 0);
