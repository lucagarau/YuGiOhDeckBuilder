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
      d._search = `${d.name || ""}\u0000${d.author || ""}\u0000${d.excerpt || ""}`
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
        name: (c && c.name) || `Carta sconosciuta (${id})`,
        type: c && c.type,
        frame_type: c && c.frame_type,
        race: c && c.race,
        attribute: c && c.attribute,
        level: c && c.level,
        atk: c && c.atk,
        defense: c && c.defense,
        archetype: c && c.archetype,
        descr: c && c.descr,
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
    return {
      q: (filters.q || "").trim().toLowerCase(),
      formats: list(filters.format).map((v) => v.toLowerCase()),
      archetypes: list(filters.archetype),
      strategies: list(filters.strategy),
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
    get capabilities() { return caps; },
    get meta() { return meta; },
  };
})();
