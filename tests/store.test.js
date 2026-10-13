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

console.log(`\n${passed} test superati, ${failed} falliti.`);
process.exit(failed ? 1 : 0);
