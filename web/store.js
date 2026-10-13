"use strict";

/**
 * Livello dati dell'app: ricerca, filtri, sorteggio, dettaglio mazzo e
 * generazione del .ydk.
 *
 * Esiste una sola implementazione di queste funzioni, qui dentro, e la
 * usano entrambe le versioni: il server locale e il sito statico su
 * GitHub Pages. Le due non possono quindi divergere, perche' non c'e'
 * una seconda copia da tenere allineata.
 *
 * Python resta responsabile solo di cio' che un browser non puo' fare
 * (scaricare da YGOPRODeck, che non manda intestazioni CORS, leggere il
 * wiki, dedurre archetipi e strategie) e congela il risultato nei JSON
 * che questo modulo legge.
 */
const Store = (() => {
  const DATA_DIR = "./data/";
  const IMG_REMOTE = "https://images.ygoprodeck.com/images/";
  const MAIN_GROUPS = ["Mostri", "Magie", "Trappole"];
  const PER_PAGE_MAX = 96;

  let decks = [];
  let cardsById = new Map();
  let aliases = new Map();
  let meta = {};
  let byNum = new Map();
  let caps = { update: false, imageProxy: false };
  let imagesDirect = null;   // null = non ancora misurato

  // ------------------------------------------------------------ caricamento

  async function json(path) {
    const resp = await fetch(path, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`${path}: errore ${resp.status}`);
    return resp.json();
  }

  /** Il server locale espone /api/capabilities, GitHub Pages no. */
  async function probeCapabilities() {
    try {
      const resp = await fetch("api/capabilities", { cache: "no-store" });
      if (!resp.ok) throw new Error("no");
      return await resp.json();
    } catch {
      return { update: false, imageProxy: false };
    }
  }

  async function load() {
    initLanguage();
    const capabilities = await probeCapabilities();
    // La sonda delle immagini serve solo senza proxy locale, e gira in
    // parallelo ai dati per non allungare l'attesa iniziale.
    const [cardList, deckList, metaData, direct] = await Promise.all([
      json(DATA_DIR + "cards.json"),
      json(DATA_DIR + "decks.json"),
      json(DATA_DIR + "meta.json"),
      capabilities.imageProxy ? Promise.resolve(true) : probeImages(),
    ]);
    imagesDirect = direct;

    cardsById = new Map(cardList.map((c) => [c.id, c]));
    decks = deckList;
    byNum = new Map(decks.map((d) => [d.deck_num, d]));
    meta = metaData;
    caps = capabilities;
    aliases = new Map(
      Object.entries(metaData.aliases || {}).map(([a, c]) => [Number(a), c])
    );

    // Campi derivati, calcolati una volta sola: la ricerca li legge a ogni
    // battuta di tasto e non puo' permettersi di ricostruirli ogni volta.
    for (const d of decks) {
      d._search = `${d.name || ""}|${d.author || ""}|${d.excerpt || ""}`
        .toLowerCase();
      d._format = (d.format || "").toLowerCase();
      d._archetypes = new Set(d.archetypes || []);
      d._strategies = new Set(d.strategies || []);
      d.main_count = (d.main || []).length;
      d.extra_count = (d.extra || []).length;
      d.side_count = (d.side || []).length;
    }
    return stats();
  }

  // ------------------------------------------------------------------ carte

  function card(id) {
    return cardsById.get(id) || cardsById.get(aliases.get(id)) || null;
  }

  function imgFolder(size) {
    return size === "full" ? "cards" : "cards_small";
  }

  function proxied(id, size) {
    return (
      "https://images.weserv.nl/?url=" +
      encodeURIComponent(`images.ygoprodeck.com/images/${imgFolder(size)}/${id}.jpg`)
    );
  }

  function imgUrl(id, size) {
    if (caps.imageProxy) {
      return "api/img/" + id + (size === "full" ? "?size=full" : "");
    }
    return imagesDirect === false
      ? proxied(id, size)
      : `${IMG_REMOTE}${imgFolder(size)}/${id}.jpg`;
  }

  /**
   * Una sola immagine di prova dice se il sito delle carte e' raggiungibile.
   * Senza, ogni carta aspetterebbe il timeout della connessione prima di
   * ripiegare sul proxy: una volta misurato, si parte subito dalla strada
   * giusta.
   */
  function probeImages(timeout = 2000) {
    return new Promise((resolve) => {
      const img = new Image();
      const finish = (ok) => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeout);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = `${IMG_REMOTE}cards_small/46986414.jpg?p=${Date.now()}`;
    });
  }

  /**
   * Diversi provider italiani bloccano i domini Yu-Gi-Oh a livello di SNI:
   * per chi e' dietro quel filtro images.ygoprodeck.com non risponde e le
   * carte resterebbero dei riquadri vuoti. Al primo errore si riprova una
   * volta sola passando da un proxy di immagini, che invece e'
   * raggiungibile.
   */
  function imgFallback(el) {
    if (!el || el.dataset.fallback) return;
    el.dataset.fallback = "1";
    const id = el.dataset.cardId;
    if (!id) return;
    imagesDirect = false;          // la prossima schermata parte gia' dal proxy
    el.src = proxied(id, el.dataset.cardSize || "small");
  }

  function group(c) {
    const kind = ((c && c.type) || "").toLowerCase();
    if (kind.includes("spell")) return "Magie";
    if (kind.includes("trap")) return "Trappole";
    return "Mostri";
  }

  /** Da lista di passcode ripetuti a voci con quantita', ordinate. */
  function expand(ids) {
    const counts = new Map();
    for (const id of ids || []) counts.set(id, (counts.get(id) || 0) + 1);

    const entries = [];
    for (const [id, qty] of counts) {
      const c = card(id);
      entries.push({
        id,
        qty,
        name: cardName(c) || `Carta sconosciuta (${id})`,
        type: c && c.type,
        frame_type: c && c.frame_type,
        race: c && c.race,
        attribute: c && c.attribute,
        level: c && c.level,
        atk: c && c.atk,
        defense: c && c.defense,
        archetype: c && c.archetype,
        descr: cardText(c),
        linkval: c && c.linkval,
        link_markers: (c && c.link_markers) || [],
        scale: c && c.scale,
        group: group(c),
        known: Boolean(c),
      });
    }
    entries.sort((a, b) => {
      const ga = MAIN_GROUPS.indexOf(a.group);
      const gb = MAIN_GROUPS.indexOf(b.group);
      if (ga !== gb) return ga - gb;
      const la = a.level || 0;
      const lb = b.level || 0;
      if (la !== lb) return lb - la;
      return (a.name || "").localeCompare(b.name || "", "it");
    });
    return entries;
  }

  // ---------------------------------------------------------------- filtri

  function matches(d, f) {
    if (f.cardId && !f.cardDecks.has(d.deck_num)) return false;
    if (f.q && !d._search.includes(f.q)) return false;
    if (f.formats.length && !f.formats.includes(d._format)) return false;
    if (f.archetypes.length && !f.archetypes.some((a) => d._archetypes.has(a)))
      return false;
    if (f.strategies.length && !f.strategies.some((s) => d._strategies.has(s)))
      return false;
    return true;
  }

  /**
   * Normalizza i criteri. Formati, archetipi e strategie accettano sia un
   * valore solo sia una lista: dentro la stessa categoria valgono in OR,
   * fra categorie diverse in AND ("Goat o Edison, ma burn").
   */
  function normalize(filters) {
    const list = (v) =>
      (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
    const cardId = filters.cardId ? Number(filters.cardId) : null;
    return {
      q: (filters.q || "").trim().toLowerCase(),
      formats: list(filters.format).map((v) => v.toLowerCase()),
      archetypes: list(filters.archetype),
      strategies: list(filters.strategy),
      cardId,
      cardDecks: cardId ? new Set(cardDecks(cardId)) : null,
    };
  }

  function filtered(filters) {
    const f = normalize(filters);
    return decks.filter((d) => matches(d, f));
  }

  // I mazzi senza prezzo finiscono in fondo in entrambi i versi: in mezzo
  // ai risultati sarebbero solo rumore.
  const SORTS = {
    recent: (a, b) => b.deck_num - a.deck_num,
    views: (a, b) => (b.views || 0) - (a.views || 0) || b.deck_num - a.deck_num,
    price_asc: (a, b) =>
      (a.price == null) - (b.price == null) ||
      (a.price || 0) - (b.price || 0) ||
      b.deck_num - a.deck_num,
    price_desc: (a, b) =>
      (a.price == null) - (b.price == null) ||
      (b.price || 0) - (a.price || 0) ||
      b.deck_num - a.deck_num,
    name: (a, b) => (a.name || "").localeCompare(b.name || "", "it"),
  };

  function search(filters = {}) {
    const found = filtered(filters);
    found.sort(SORTS[filters.sort] || SORTS.recent);

    const perPage = Math.max(1, Math.min(PER_PAGE_MAX, filters.perPage || 24));
    const pages = Math.max(1, Math.ceil(found.length / perPage));
    const page = Math.max(1, Math.min(pages, filters.page || 1));
    const start = (page - 1) * perPage;

    return {
      total: found.length,
      page,
      pages,
      per_page: perPage,
      items: found.slice(start, start + perPage),
    };
  }

  function count(filters = {}) {
    return filtered(filters).length;
  }

  function random(filters = {}) {
    const pool = filtered(filters);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // --------------------------------------------------------------- dettaglio

  function deck(deckNum) {
    const d = byNum.get(Number(deckNum));
    if (!d) return null;
    const full = Object.assign({}, d);
    full.main_cards = expand(d.main);
    full.extra_cards = expand(d.extra);
    full.side_cards = expand(d.side);
    full.missing_cards = [...full.main_cards, ...full.extra_cards, ...full.side_cards]
      .filter((e) => !e.known)
      .map((e) => e.id);
    full.strategy_labels = (d.strategies || []).map(
      (k) => (meta.strategy_labels || {})[k] || k
    );
    full.ydk = buildYdk(d);
    full.ydk_filename = ydkFilename(d);
    return full;
  }

  // ------------------------------------------------------------------- ydk

  /** Formato atteso da YGOPro / EDOPro / Omega: righe CRLF e riga finale. */
  function buildYdk(d) {
    const lines = ["#created by " + (d.author || "YuGiOhDeckBuilder")];
    if (d.name) lines.push("#" + String(d.name).replace(/\n/g, " ").trim());
    lines.push("#main", ...(d.main || []).map(String));
    lines.push("#extra", ...(d.extra || []).map(String));
    lines.push("!side", ...(d.side || []).map(String));
    return lines.join("\r\n") + "\r\n";
  }

  function ydkFilename(d) {
    let base = String(d.name || "deck").trim();
    // eslint-disable-next-line no-control-regex
    base = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
    base = base.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
    base = base.slice(0, 80) || "deck";
    return `${base} - ${d.deck_num}.ydk`;
  }

  function downloadYdk(d) {
    const blob = new Blob([buildYdk(d)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ydkFilename(d);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----------------------------------------------------------- vocabolari

  function tally(pick) {
    const counts = new Map();
    for (const d of decks) {
      const value = pick(d);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, key: name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "it"));
  }

  const formats = () => tally((d) => d.format);
  const archetypes = () => tally((d) => d.archetype);

  function strategies() {
    return tally((d) => d.strategy).map((s) =>
      Object.assign(s, { label: (meta.strategy_labels || {})[s.key] || s.key })
    );
  }


  // ------------------------------------------------- ricerca fra le carte

  // Due indici pesanti da costruire e inutili finche' nessuno apre la
  // sezione carte: si preparano alla prima richiesta, non al caricamento.
  let deckIndex = null;
  let cardList = null;

  function canonical(id) {
    return aliases.get(id) || id;
  }

  /** {passcode canonico: [numeri dei mazzi che la usano]} */
  function buildDeckIndex() {
    const index = new Map();
    for (const d of decks) {
      // Un mazzo che ha la stessa carta nel main e nell'extra va contato
      // una volta sola.
      const seen = new Set();
      for (const zone of [d.main, d.extra, d.side]) {
        for (const raw of zone || []) seen.add(canonical(raw));
      }
      for (const id of seen) {
        const bucket = index.get(id);
        if (bucket) bucket.push(d.deck_num);
        else index.set(id, [d.deck_num]);
      }
    }
    return index;
  }

  function cardDecks(id) {
    if (!deckIndex) deckIndex = buildDeckIndex();
    return deckIndex.get(canonical(id)) || [];
  }

  function cardDeckCount(id) {
    return cardDecks(id).length;
  }

  function decksWithCard(id) {
    const nums = new Set(cardDecks(id));
    return decks.filter((d) => nums.has(d.deck_num));
  }

  function buildCardList() {
    if (!deckIndex) deckIndex = buildDeckIndex();
    return [...cardsById.values()].map((c) => {
      const kind = (c.type || "").toLowerCase();
      return Object.assign({}, c, {
        name: cardName(c),
        descr: cardText(c),
        name_en: c.name,
        group: group(c),
        // Cercare anche nell'effetto e' il motivo per cui si viene qui:
        // "banish", "negate", "once per turn".
        // Cercabile in entrambe le lingue: chi gioca online conosce i
        // nomi inglesi anche se usa l'interfaccia in italiano.
        _search: [c.name, c.descr, c.name_it, c.descr_it]
          .filter(Boolean).join("|").toLowerCase(),
        _deckCount: cardDeckCount(c.id),
        // Livello, rango e valore Link occupano la stessa casella.
        _rank: c.linkval != null ? c.linkval : c.level,
        _isSpellTrap: kind.includes("spell") || kind.includes("trap"),
      });
    });
  }

  function allCards() {
    if (!cardList) cardList = buildCardList();
    return cardList;
  }

  const CARD_SORTS = {
    decks: (a, b) => b._deckCount - a._deckCount || a.name.localeCompare(b.name, "it"),
    name: (a, b) => a.name.localeCompare(b.name, "it"),
    atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1) || a.name.localeCompare(b.name, "it"),
    def: (a, b) => (b.defense ?? -1) - (a.defense ?? -1) || a.name.localeCompare(b.name, "it"),
    level: (a, b) => (b._rank ?? -1) - (a._rank ?? -1) || a.name.localeCompare(b.name, "it"),
  };

  function searchCards(filters = {}) {
    const q = (filters.q || "").trim().toLowerCase();
    const group_ = filters.group || "";
    const attribute = filters.attribute || "";
    const race = filters.race || "";
    const archetype = filters.archetype || "";
    const level = filters.level === "" || filters.level == null
      ? null
      : Number(filters.level);

    let found = allCards().filter((c) => {
      if (q && !c._search.includes(q)) return false;
      if (group_ && c.group !== group_) return false;
      if (attribute && c.attribute !== attribute) return false;
      if (race && c.race !== race) return false;
      if (archetype && c.archetype !== archetype) return false;
      if (level != null && c._rank !== level) return false;
      return true;
    });

    found = found.slice().sort(CARD_SORTS[filters.sort] || CARD_SORTS.decks);

    const perPage = Math.max(1, Math.min(PER_PAGE_MAX, filters.perPage || 36));
    const pages = Math.max(1, Math.ceil(found.length / perPage));
    const page = Math.max(1, Math.min(pages, filters.page || 1));
    const start = (page - 1) * perPage;
    return {
      total: found.length,
      page, pages, per_page: perPage,
      items: found.slice(start, start + perPage),
    };
  }

  /** Valori effettivamente presenti, per riempire i menu dei filtri. */
  function cardFacets() {
    const attributes = new Set();
    const races = new Set();
    const levels = new Set();
    for (const c of allCards()) {
      if (c.attribute) attributes.add(c.attribute);
      if (c.race) races.add(c.race);
      if (c._rank != null) levels.add(c._rank);
    }
    return {
      attributes: [...attributes].sort(),
      races: [...races].sort((a, b) => a.localeCompare(b, "it")),
      levels: [...levels].sort((a, b) => a - b),
    };
  }


  // ----------------------------------------------------- costruzione mazzi

  // Verificato sui mazzi reali: nell'Extra finiscono solo queste famiglie,
  // varianti Pendulum comprese. I Rituali restano nel Main.
  const EXTRA_FRAMES = /fusion|synchro|xyz|link/;

  const DECK_LIMITS = {
    main: { min: 40, max: 60 },
    extra: { min: 0, max: 15 },
    side: { min: 0, max: 15 },
  };
  const MAX_COPIES = 3;

  function cardZone(c) {
    return c && EXTRA_FRAMES.test((c.frame_type || "").toLowerCase())
      ? "extra"
      : "main";
  }

  /** La zona giusta per questo passcode, risolvendo gli artwork alternativi. */
  function zoneFor(id) {
    return cardZone(card(id));
  }

  /**
   * Controlla un mazzo secondo le regole ufficiali: dimensioni delle zone
   * e massimo tre copie **in tutto il mazzo**, non per zona.
   */
  function validateDeck(deck, format) {
    const errors = [];
    const counts = {
      main: (deck.main || []).length,
      extra: (deck.extra || []).length,
      side: (deck.side || []).length,
    };

    for (const zone of ["main", "extra", "side"]) {
      const { min, max } = DECK_LIMITS[zone];
      const label = { main: "Main Deck", extra: "Extra Deck", side: "Side Deck" }[zone];
      if (counts[zone] > max) {
        errors.push(`${label}: ${counts[zone]} carte, il massimo e' ${max}.`);
      } else if (counts[zone] < min) {
        errors.push(`${label}: ${counts[zone]} carte, il minimo e' ${min}.`);
      }
    }

    const copies = new Map();
    for (const zone of ["main", "extra", "side"]) {
      for (const id of deck[zone] || []) {
        const key = canonical(id);
        copies.set(key, (copies.get(key) || 0) + 1);
      }
    }
    for (const [id, n] of copies) {
      // Il limite generale e' tre copie, ma la lista del formato puo'
      // abbassarlo fino a zero.
      const limit = banLimit(id, format);
      if (n > limit) {
        const c = card(id);
        const name = cardName(c) || id;
        errors.push(
          limit < MAX_COPIES
            ? `${name}: ${BAN_LABELS[limit]} in ${BAN_FORMAT_LABELS[format]}, ne hai ${n}.`
            : `${name}: ${n} copie, il massimo e' ${MAX_COPIES}.`
        );
      }
    }

    // Una carta nella zona sbagliata rende il mazzo non caricabile.
    for (const id of deck.extra || []) {
      if (zoneFor(id) !== "extra") {
        const c = card(id);
        errors.push(`${cardName(c) || id} non va nell'Extra Deck.`);
      }
    }
    for (const id of deck.main || []) {
      if (zoneFor(id) === "extra") {
        const c = card(id);
        errors.push(`${cardName(c) || id} va nell'Extra Deck.`);
      }
    }

    return { ok: errors.length === 0, errors, counts };
  }

  /** Quante copie di una carta ci sono gia' in tutto il mazzo. */
  function copiesOf(deck, id) {
    const key = canonical(id);
    let n = 0;
    for (const zone of ["main", "extra", "side"]) {
      for (const other of deck[zone] || []) if (canonical(other) === key) n += 1;
    }
    return n;
  }

  // ------------------------------------------------------------ file .ydk

  /** Legge un .ydk. Tollerante: righe sconosciute ignorate. */
  function parseYdk(text) {
    const deck = { name: "", author: "", main: [], extra: [], side: [] };
    let zone = "main";
    let seenMarker = false;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const lower = line.toLowerCase();
      if (lower === "#main") { zone = "main"; seenMarker = true; continue; }
      if (lower === "#extra") { zone = "extra"; seenMarker = true; continue; }
      if (lower === "!side" || lower === "#side") { zone = "side"; seenMarker = true; continue; }

      if (line.startsWith("#") || line.startsWith("!")) {
        const comment = line.slice(1).trim();
        if (/^created by\s+/i.test(comment)) {
          deck.author = comment.replace(/^created by\s+/i, "").trim();
        } else if (!seenMarker && !deck.name) {
          deck.name = comment;
        }
        continue;
      }

      if (/^\d+$/.test(line)) deck[zone].push(Number(line));
    }
    return deck;
  }

  /**
   * Rimette ogni carta nella sua zona. I .ydk scritti a mano o da altri
   * programmi a volte hanno mostri dell'Extra nel Main.
   */
  function tidyDeck(deck) {
    const out = { main: [], extra: [], side: [...(deck.side || [])] };
    const moved = [];
    for (const zone of ["main", "extra"]) {
      for (const id of deck[zone] || []) {
        const target = zoneFor(id);
        out[target].push(id);
        if (target !== zone) moved.push(id);
      }
    }
    return { deck: out, moved };
  }

  // ------------------------------------------------- mazzi salvati in locale

  const STORAGE_KEY = "ygodeck.mydecks";

  function readStorage() {
    // In navigazione privata o con i dati del sito bloccati puo' lanciare.
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeStorage(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  function savedDecks() {
    return readStorage().sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));
  }

  function saveDeck(deck) {
    const list = readStorage();
    const entry = {
      id: deck.id || "d" + Date.now().toString(36),
      name: deck.name || "Mazzo senza nome",
      main: [...(deck.main || [])],
      extra: [...(deck.extra || [])],
      side: [...(deck.side || [])],
      saved_at: new Date().toISOString(),
    };
    const at = list.findIndex((d) => d.id === entry.id);
    if (at >= 0) list[at] = entry;
    else list.push(entry);
    return writeStorage(list) ? entry : null;
  }

  function deleteSavedDeck(id) {
    return writeStorage(readStorage().filter((d) => d.id !== id));
  }

  function storageWorks() {
    try {
      localStorage.setItem(STORAGE_KEY + ".test", "1");
      localStorage.removeItem(STORAGE_KEY + ".test");
      return true;
    } catch {
      return false;
    }
  }


  // ---------------------------------------------------------- lingua

  let lang = "it";

  function setLanguage(value) {
    if (value === lang) return;
    lang = value === "en" ? "en" : "it";
    cardList = null;          // i nomi mostrati cambiano: indice da rifare
    try {
      localStorage.setItem("ygodeck.lang", lang);
    } catch { /* senza memoria la scelta vale solo per questa visita */ }
  }

  function initLanguage() {
    try {
      const saved = localStorage.getItem("ygodeck.lang");
      if (saved === "en" || saved === "it") lang = saved;
    } catch { /* resta il valore predefinito */ }
  }

  /** Nome nella lingua scelta, con ripiego sull'inglese. */
  function cardName(c) {
    if (!c) return "";
    return (lang === "it" && c.name_it) || c.name || "";
  }

  function cardText(c) {
    if (!c) return "";
    return (lang === "it" && c.descr_it) || c.descr || "";
  }

  // ------------------------------------------------- liste di divieti

  const BAN_LABELS = { 0: "Vietata", 1: "Limitata", 2: "Semi-limitata" };
  const BAN_FORMAT_LABELS = { tcg: "TCG", ocg: "OCG", goat: "Goat Format" };

  /** Copie massime di una carta nel formato scelto; 3 se non e' in lista. */
  function banLimit(id, format) {
    if (!format) return MAX_COPIES;
    const c = card(id);
    const ban = c && c.ban;
    if (!ban || ban[format] == null) return MAX_COPIES;
    return ban[format];
  }

  function banStatus(id, format) {
    const limit = banLimit(id, format);
    return limit >= MAX_COPIES ? null : { limit, label: BAN_LABELS[limit] };
  }

  /** Le carte di un mazzo che il formato non ammette in quella quantita'. */
  function banIssues(deck, format) {
    if (!format) return [];
    const copies = new Map();
    for (const zone of ["main", "extra", "side"]) {
      for (const id of deck[zone] || []) {
        const key = canonical(id);
        copies.set(key, (copies.get(key) || 0) + 1);
      }
    }
    const issues = [];
    for (const [id, n] of copies) {
      const limit = banLimit(id, format);
      if (n > limit) {
        issues.push({
          id, copies: n, limit,
          name: cardName(card(id)) || String(id),
          label: BAN_LABELS[limit] || "fuori lista",
        });
      }
    }
    return issues.sort(
      (a, b) => a.limit - b.limit || a.name.localeCompare(b.name, "it")
    );
  }

  /** Il formato di gioco suggerito da un mazzo dell'archivio. */
  function formatOf(deck) {
    const name = (deck.format || "").toLowerCase();
    if (name.includes("goat")) return "goat";
    if (name.includes("ocg") || name.includes("world")) return "ocg";
    if (name.startsWith("tag force")) return null;   // videogioco: nessuna lista
    return "tcg";
  }

  // --------------------------------------------------------- ydke e link

  function toBase64(bytes) {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  /** I passcode viaggiano come interi a 32 bit, byte meno significativo primo. */
  function idsToBase64(ids) {
    const buffer = new ArrayBuffer((ids || []).length * 4);
    const view = new DataView(buffer);
    (ids || []).forEach((id, i) => view.setUint32(i * 4, id, true));
    return toBase64(new Uint8Array(buffer));
  }

  function base64ToIds(text) {
    if (!text) return [];
    const bytes = fromBase64(text);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = [];
    for (let i = 0; i + 4 <= bytes.byteLength; i += 4) out.push(view.getUint32(i, true));
    return out;
  }

  /** Il formato che EDOPro, Omega e Duelingbook accettano incollato. */
  function buildYdke(deck) {
    return (
      "ydke://" +
      idsToBase64(deck.main) + "!" +
      idsToBase64(deck.extra) + "!" +
      idsToBase64(deck.side) + "!"
    );
  }

  function parseYdke(text) {
    const match = String(text).trim().match(/ydke:[/][/]([^!]*)!([^!]*)!([^!]*)!?/i);
    if (!match) return null;
    return {
      main: base64ToIds(match[1]),
      extra: base64ToIds(match[2]),
      side: base64ToIds(match[3]),
    };
  }

  /** Mazzo dentro un link: stessa codifica dello ydke, resa sicura per URL. */
  function deckToHash(deck) {
    const body = [deck.main, deck.extra, deck.side].map(idsToBase64).join("!");
    const safe = body.replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/=/g, "");
    const name = encodeURIComponent(deck.name || "");
    return "#mazzo=" + safe + (name ? "&nome=" + name : "");
  }

  function deckFromHash(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const body = params.get("mazzo");
    if (!body) return null;
    const parts = body.replace(/-/g, "+").replace(/_/g, "/").split("!");
    try {
      return {
        name: params.get("nome") || "",
        main: base64ToIds(parts[0]),
        extra: base64ToIds(parts[1]),
        side: base64ToIds(parts[2]),
      };
    } catch {
      return null;      // link rovinato dal copia-incolla
    }
  }

  // ------------------------------------------------- statistiche del mazzo

  // Con i fattoriali si va in overflow: i logaritmi tengono i numeri piccoli.
  const logFactCache = [0, 0];
  function logFact(n) {
    for (let i = logFactCache.length; i <= n; i += 1) {
      logFactCache[i] = logFactCache[i - 1] + Math.log(i);
    }
    return logFactCache[n];
  }

  function logC(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return logFact(n) - logFact(k) - logFact(n - k);
  }

  function hyper(N, K, n, x) {
    if (x > K || n - x > N - K || x < 0 || n - x < 0) return 0;
    return Math.exp(logC(K, x) + logC(N - K, n - x) - logC(N, n));
  }

  /**
   * Probabilita' di pescare almeno `wanted` copie in `draws` carte.
   * Si calcola come complemento: 1 meno la probabilita' di pescarne meno.
   */
  function atLeast(population, successes, draws, wanted) {
    const need = wanted || 1;
    if (successes <= 0 || draws <= 0 || population <= 0) return 0;
    let miss = 0;
    for (let x = 0; x < need; x += 1) miss += hyper(population, successes, draws, x);
    return Math.max(0, Math.min(1, 1 - miss));
  }

  function deckStats(deck) {
    const main = deck.main || [];
    const entries = expand(main);
    const groups = { Mostri: 0, Magie: 0, Trappole: 0 };
    const levels = new Map();
    const attributes = new Map();
    const races = new Map();

    for (const e of entries) {
      groups[e.group] = (groups[e.group] || 0) + e.qty;
      if (e.group !== "Mostri") continue;
      const lv = e.linkval != null ? "LINK-" + e.linkval : e.level;
      if (lv != null) levels.set(lv, (levels.get(lv) || 0) + e.qty);
      if (e.attribute) attributes.set(e.attribute, (attributes.get(e.attribute) || 0) + e.qty);
      if (e.race) races.set(e.race, (races.get(e.race) || 0) + e.qty);
    }

    const sortCount = (map) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, count: v }));

    // Le carte piu' numerose sono quelle su cui conta sapere la
    // probabilita' di aprirle.
    const draws = 5;
    const opening = entries
      .slice()
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "it"))
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        name: e.name,
        qty: e.qty,
        chance: atLeast(main.length, e.qty, draws, 1),
      }));

    return {
      size: main.length,
      groups,
      levels: [...levels.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "it", { numeric: true }))
        .map(([k, v]) => ({ key: k, count: v })),
      attributes: sortCount(attributes),
      races: sortCount(races).slice(0, 6),
      draws,
      opening,
    };
  }

  // --------------------------------------------- sinergie e mazzi simili

  let deckSets = null;

  function allDeckSets() {
    if (!deckSets) {
      deckSets = decks.map((d) => {
        const set = new Set();
        for (const zone of ["main", "extra", "side"]) {
          for (const id of d[zone] || []) set.add(canonical(id));
        }
        return set;
      });
    }
    return deckSets;
  }

  /**
   * Carte che si giocano insieme a quelle date.
   *
   * Contare le presenze grezze non basta: verrebbero fuori solo gli staple,
   * che stanno in ogni mazzo. Si divide quindi per quanto una carta e'
   * comune in generale, e resta cio' che e' davvero tipico di queste.
   */
  function suggestCards(ids, options) {
    const opts = options || {};
    const limit = opts.limit || 12;
    const minShared = opts.minShared || 3;
    const wanted = [...new Set((ids || []).map(canonical))].filter((id) => card(id));
    if (!wanted.length) return [];

    const sets = allDeckSets();
    const total = decks.length;
    const matching = [];
    for (let i = 0; i < sets.length; i += 1) {
      if (wanted.some((id) => sets[i].has(id))) matching.push(i);
    }
    if (matching.length < minShared) return [];

    const have = new Set(wanted);
    const together = new Map();
    for (const i of matching) {
      for (const id of sets[i]) {
        if (!have.has(id)) together.set(id, (together.get(id) || 0) + 1);
      }
    }

    const out = [];
    for (const [id, n] of together) {
      if (n < minShared) continue;
      const overall = cardDecks(id).length;
      if (!overall) continue;
      const c = card(id);
      if (!c) continue;
      out.push({
        id,
        name: cardName(c),
        decks: n,
        share: n / matching.length,
        lift: (n / matching.length) / (overall / total),
      });
    }
    out.sort((a, b) => b.lift - a.lift || b.decks - a.decks);
    return out.slice(0, limit);
  }

  /** Mazzi che condividono piu' carte con questo. */
  function similarDecks(deck, options) {
    const limit = (options || {}).limit || 6;
    const mine = new Set();
    for (const zone of ["main", "extra", "side"]) {
      for (const id of deck[zone] || []) mine.add(canonical(id));
    }
    if (!mine.size) return [];

    const sets = allDeckSets();
    const out = [];
    for (let i = 0; i < sets.length; i += 1) {
      if (decks[i].deck_num === deck.deck_num) continue;
      let shared = 0;
      for (const id of sets[i]) if (mine.has(id)) shared += 1;
      if (shared < 5) continue;
      // Jaccard: premia la somiglianza, non il mazzo piu' grande.
      out.push({
        deck: decks[i],
        shared,
        score: shared / (mine.size + sets[i].size - shared),
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  function stats() {
    return {
      decks: decks.length,
      cards: cardsById.size,
      formats: new Set(decks.map((d) => d.format).filter(Boolean)).size,
      archetypes: new Set(decks.map((d) => d.archetype).filter(Boolean)).size,
      last_deck_update: meta.last_deck_update,
      last_card_update: meta.last_card_update,
      generated_at: meta.generated_at,
    };
  }

  return {
    load, stats, search, count, random, deck, card, expand, imgUrl, imgFallback,
    formats, archetypes, strategies, buildYdk, ydkFilename, downloadYdk,
    searchCards, cardFacets, cardDeckCount, decksWithCard,
    cardZone, zoneFor, validateDeck, copiesOf, parseYdk, tidyDeck,
    setLanguage, initLanguage, cardName, cardText,
    banLimit, banStatus, banIssues, formatOf,
    buildYdke, parseYdke, deckToHash, deckFromHash,
    deckStats, atLeast, suggestCards, similarDecks,
    get language() { return lang; },
    get banFormats() { return BAN_FORMAT_LABELS; },
    savedDecks, saveDeck, deleteSavedDeck, storageWorks,
    get limits() { return DECK_LIMITS; },
    // Riempie lo store senza passare dalla rete: lo usa
    // tests/store.test.js, che gira anche nella GitHub Action.
    __inject(cardList, deckList, metaData) {
      cardsById = new Map(cardList.map((c) => [c.id, c]));
      decks = deckList;
      byNum = new Map(decks.map((d) => [d.deck_num, d]));
      meta = metaData;
      aliases = new Map(
        Object.entries(metaData.aliases || {}).map(([a, c]) => [Number(a), c])
      );
      for (const d of decks) {
        d._search = `${d.name || ""}|${d.author || ""}|${d.excerpt || ""}`.toLowerCase();
        d._format = (d.format || "").toLowerCase();
        d._archetypes = new Set(d.archetypes || []);
        d._strategies = new Set(d.strategies || []);
      }
      deckIndex = null;
      cardList = null;
    },
    get capabilities() { return caps; },
    get meta() { return meta; },
  };
})();
