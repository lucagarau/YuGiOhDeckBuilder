"use strict";

/**
 * Interfaccia. Non parla mai direttamente con la rete per i dati: tutto
 * passa da Store (web/store.js), che e' lo stesso in locale e su GitHub
 * Pages. L'unica cosa che cambia fra le due versioni e' la presenza del
 * tasto "Aggiorna DB", che esiste solo quando c'e' un server locale.
 */

const $ = (sel) => document.querySelector(sel);

const state = {
  page: 1,
  perPage: 24,
  total: 0,
  deck: null,
  pollTimer: null,
  strategyLabels: {},
  randomArchetypes: [],
  lastRandom: false,
  view: "decks",
  cardPage: 1,
  cardsReady: false,
  cardFilter: null,
  editing: null,
  editorReady: false,
  pickerPage: 1,
  movedNote: "",
  history: [],
  archetype: null,
};

async function api(path, options) {
  const resp = await fetch(path, options);
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || "Errore " + resp.status);
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function stripHtml(value) {
  const el = document.createElement("div");
  el.innerHTML = value || "";
  return (el.textContent || "").trim();
}

const imgUrl = (id, size) => Store.imgUrl(id, size);

// ------------------------------------------------------------- stato DB

function showStats() {
  const s = Store.stats();
  const when = s.last_deck_update
    ? new Date(s.last_deck_update).toLocaleString("it-IT")
    : "mai";
  $("#dbStats").textContent =
    `${s.decks.toLocaleString("it-IT")} mazzi · ${s.cards.toLocaleString("it-IT")} carte · ` +
    `${s.formats} formati · ${s.archetypes} archetipi · aggiornato: ${when}`;
}

/** Senza server locale non c'e' niente da aggiornare da qui. */
function applyCapabilities() {
  const canUpdate = Store.capabilities.update;
  $("#btnUpdate").classList.toggle("hidden", !canUpdate);
  $("#btnUpdateOpts").classList.toggle("hidden", !canUpdate);
  $("#staticNote").classList.toggle("hidden", canUpdate);
}

function loadFilters() {
  const formats = Store.formats();
  const strategies = Store.strategies();
  const archetypes = Store.archetypes();
  state.strategyLabels = Store.meta.strategy_labels || {};

  const strat = $("#fStrategy");
  const keptStrategy = strat.value;
  strat.innerHTML = '<option value="">Ogni funzionamento</option>';
  for (const s of strategies) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = `${s.label} (${s.count})`;
    strat.appendChild(opt);
  }
  strat.value = keptStrategy;

  const sel = $("#fFormat");
  const keptFormat = sel.value;
  sel.innerHTML = '<option value="">Tutti i formati</option>';
  for (const f of formats) {
    const opt = document.createElement("option");
    opt.value = f.name;
    opt.textContent = `${f.name} (${f.count})`;
    sel.appendChild(opt);
  }
  sel.value = keptFormat;

  fillMulti($("#rndFormats"), formats.map((f) => [f.name, `${f.name} (${f.count})`]));
  fillMulti($("#rndStrategies"), strategies.map((s) => [s.key, `${s.label} (${s.count})`]));

  $("#archetypeList").innerHTML = archetypes
    .map((a) => `<option value="${escapeHtml(a.name)}">${a.count} mazzi</option>`)
    .join("");
}

/** Le caselle dei formati da scaricare: solo con il server locale. */
async function fillUpdateFormats() {
  const boxes = $("#optFormats");
  if (boxes.dataset.filled || !Store.capabilities.update) return;
  try {
    const data = await api("api/formats");
    boxes.innerHTML = data.available
      .map(
        (f) =>
          `<label class="check"><input type="checkbox" value="${escapeHtml(f)}"> ${escapeHtml(f)}</label>`
      )
      .join("");
    boxes.dataset.filled = "1";
  } catch {
    /* il pannello resta vuoto: si aggiorna comunque su tutti i formati */
  }
}

// ------------------------------------------------------------- ricerca

function currentFilters() {
  return {
    cardId: state.cardFilter ? state.cardFilter.id : null,
    q: $("#fQuery").value.trim(),
    format: $("#fFormat").value,
    archetype: $("#fArchetype").value.trim(),
    strategy: $("#fStrategy").value,
    sort: $("#fSort").value,
    page: state.page,
    perPage: state.perPage,
  };
}

function search() {
  const grid = $("#deckGrid");
  const data = Store.search(currentFilters());

  state.total = data.total;
  state.page = data.page;
  $("#resultCount").textContent = data.total
    ? `${data.total.toLocaleString("it-IT")} mazzi trovati`
    : "";
  $("#pageLabel").textContent = `${data.page} / ${data.pages}`;
  $("#btnPrev").disabled = data.page <= 1;
  $("#btnNext").disabled = data.page >= data.pages;

  grid.innerHTML = data.items.map(deckCard).join("");
  grid.querySelectorAll(".deck-card").forEach((el) => {
    el.addEventListener("click", () => openDeck(Number(el.dataset.num)));
  });

  const note = $("#cardFilterNote");
  if (state.cardFilter) {
    note.innerHTML =
      `contengono <strong>${escapeHtml(state.cardFilter.name)}</strong>` +
      `<button aria-label="Togli il filtro">&times;</button>`;
    note.classList.remove("hidden");
    note.querySelector("button").addEventListener("click", clearCardFilter);
  } else {
    note.classList.add("hidden");
  }

  const empty = $("#emptyState");
  if (!data.total) {
    empty.textContent = Store.stats().decks
      ? "Nessun mazzo corrisponde ai filtri."
      : "Archivio vuoto.";
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
  }
}

function deckCard(d) {
  const cover = d.cover_card
    ? `<img loading="lazy" src="${imgUrl(d.cover_card)}" alt="" data-card-id="${d.cover_card}"
         onerror="Store.imgFallback(this)">`
    : '<span class="noimg">nessuna immagine</span>';
  const tags = [];
  if (d.format) tags.push(`<span class="tag fmt">${escapeHtml(d.format)}</span>`);
  if (d.archetype) tags.push(`<span class="tag">${escapeHtml(d.archetype)}</span>`);
  if (d.strategy)
    tags.push(
      `<span class="tag str">${escapeHtml(
        state.strategyLabels[d.strategy] || d.strategy
      )}</span>`
    );
  if (d.tournament_place)
    tags.push(`<span class="tag trn">${escapeHtml(d.tournament_place)}</span>`);

  const price = d.price ? ` · $${d.price.toFixed(2)}` : "";
  return `
  <article class="deck-card" data-num="${d.deck_num}">
    <div class="deck-cover">${cover}</div>
    <div class="deck-info">
      <div class="deck-name">${escapeHtml(d.name)}</div>
      <div class="tags">${tags.join("")}</div>
      <div class="deck-sub">${escapeHtml(d.author || "anonimo")}${price}</div>
      <div class="counts">Main ${d.main_count} · Extra ${d.extra_count}${
    d.side_count ? ` · Side ${d.side_count}` : ""
  }</div>
    </div>
  </article>`;
}

// ------------------------------------------------------------- random

function fillMulti(select, pairs) {
  const chosen = new Set(Array.from(select.selectedOptions).map((o) => o.value));
  select.innerHTML = "";
  for (const [value, label] of pairs) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = chosen.has(value);
    select.appendChild(opt);
  }
}

function multiValues(select) {
  return Array.from(select.selectedOptions).map((o) => o.value);
}

function renderChips() {
  $("#rndArchetypeChips").innerHTML = state.randomArchetypes
    .map(
      (a, i) =>
        `<span class="chip">${escapeHtml(a)}<button data-i="${i}" aria-label="Rimuovi">&times;</button></span>`
    )
    .join("");
  $("#rndArchetypeChips")
    .querySelectorAll("button")
    .forEach((b) =>
      b.addEventListener("click", () => {
        state.randomArchetypes.splice(Number(b.dataset.i), 1);
        renderChips();
        updatePool();
      })
    );
}

function randomFilters() {
  return {
    format: multiValues($("#rndFormats")),
    strategy: multiValues($("#rndStrategies")),
    archetype: state.randomArchetypes,
  };
}

function updatePool() {
  const pool = Store.count(randomFilters());
  $("#rndPool").textContent = pool
    ? `${pool.toLocaleString("it-IT")} mazzi fra cui pescare`
    : "Nessun mazzo con questi criteri";
  $("#btnDraw").disabled = !pool;
}

function drawRandom() {
  const picked = Store.random(randomFilters());
  if (!picked) {
    $("#rndPool").textContent = "Nessun mazzo corrisponde ai criteri scelti";
    return;
  }
  state.lastRandom = true;
  showDeck(Store.deck(picked.deck_num));
}

// ------------------------------------------------------------- dettaglio

function openDeck(deckNum) {
  state.lastRandom = false;
  const deck = Store.deck(deckNum);
  if (!deck) return;
  showDeck(deck);
}

function showDeck(deck) {
  $("#overlay").classList.remove("hidden");
  state.deck = deck;
  $("#btnReroll").classList.toggle("hidden", !state.lastRandom);

  $("#deckTitle").textContent = deck.name;
  const bits = [deck.author || "anonimo", deck.format];
  if (deck.strategy_labels && deck.strategy_labels.length)
    bits.push(deck.strategy_labels.join(" + "));
  if (deck.tournament_name)
    bits.push(
      `${deck.tournament_name}${deck.tournament_place ? " — " + deck.tournament_place : ""}`
    );
  if (deck.price) bits.push("$" + Number(deck.price).toFixed(2));
  if (deck.submit_date) bits.push(deck.submit_date);
  $("#deckMeta").textContent = bits.filter(Boolean).join(" · ");

  // Ogni fonte ha la sua pagina: il link deve portare a quella giusta.
  const SOURCE_LABELS = {
    tagforce: "Apri sul wiki",
    masterduel: "Apri su Master Duel Meta",
  };
  const link = $("#linkSource");
  if (deck.source_url && SOURCE_LABELS[deck.source]) {
    link.href = deck.source_url;
    link.textContent = SOURCE_LABELS[deck.source];
  } else {
    link.href = "https://ygoprodeck.com/deck/" + encodeURIComponent(deck.pretty_url || "");
    link.textContent = "Apri su YGOPRODeck";
  }

  const parts = [];
  if (deck.missing_cards && deck.missing_cards.length)
    parts.push(
      `<p class="warn">${deck.missing_cards.length} carte non sono nel database locale ` +
        `(il .ydk resta corretto, usa i passcode).</p>`
    );
  if (deck.unresolved && deck.unresolved.length)
    parts.push(
      `<p class="warn">${deck.unresolved.length} carte di questo mazzo non esistono ` +
        `nel database TCG (esclusive OCG o del videogioco) e non sono nel .ydk: ` +
        `${escapeHtml(deck.unresolved.slice(0, 8).join(", "))}` +
        `${deck.unresolved.length > 8 ? "..." : ""}</p>`
    );

  const desc = stripHtml(deck.excerpt);
  if (desc) parts.push(`<p class="deck-desc">${escapeHtml(desc.slice(0, 600))}</p>`);

  const fmt = Store.formatOf(deck);
  const issues = Store.banIssues(deck, fmt);
  if (fmt) {
    const label = Store.banFormats[fmt];
    parts.push(
      issues.length
        ? `<p class="legal bad"><strong>Non valido in ${label}:</strong> ` +
            issues.map((i) => `${escapeHtml(i.name)} (${i.label}, ne ha ${i.copies})`).join(", ") +
            `</p>`
        : `<p class="legal good">Valido secondo la lista ${label}.</p>`
    );
  }

  parts.push(zoneHtml("Main Deck", deck.main_cards, deck.main.length));
  parts.push(zoneHtml("Extra Deck", deck.extra_cards, deck.extra.length));
  if (deck.side.length)
    parts.push(zoneHtml("Side Deck", deck.side_cards, deck.side.length));

  parts.push(statsHtml(deck));
  parts.push(similarHtml(deck));
  $("#deckBody").innerHTML = parts.filter(Boolean).join("");
  $("#deckBody").querySelectorAll(".similar-item").forEach((b) =>
    b.addEventListener("click", () => openDeck(Number(b.dataset.num)))
  );
}

function zoneHtml(title, entries, total) {
  if (!entries || !entries.length) return "";
  const counts = {};
  for (const e of entries) counts[e.group] = (counts[e.group] || 0) + e.qty;
  const breakdown = ["Mostri", "Magie", "Trappole"]
    .filter((g) => counts[g])
    .map((g) => `${g} ${counts[g]}`)
    .join(" · ");

  const tiles = entries
    .map(
      (e) => `
    <div class="card-tile" data-id="${e.id}" role="button" tabindex="0"
         title="${escapeHtml(e.name)} - clicca per i dettagli">
      <img loading="lazy" src="${imgUrl(e.id)}" alt="${escapeHtml(e.name)}"
           data-card-id="${e.id}" onerror="Store.imgFallback(this)">
      <span class="qty">x${e.qty}</span>
      <div class="cname">${escapeHtml(e.name)}</div>
    </div>`
    )
    .join("");

  return `
  <section class="zone">
    <div class="zone-head">
      <h3>${title}</h3>
      <span class="muted">${total} carte${breakdown ? " · " + breakdown : ""}</span>
    </div>
    <div class="card-grid">${tiles}</div>
  </section>`;
}





// --------------------------------------------------- lingua delle carte

function applyLanguage() {
  $("#btnLang").textContent = Store.language.toUpperCase();
  $("#btnLang").title =
    Store.language === "it"
      ? "Nomi in italiano - premi per l'inglese"
      : "Nomi in inglese - premi per l'italiano";
}

function toggleLanguage() {
  Store.setLanguage(Store.language === "it" ? "en" : "it");
  applyLanguage();
  // Tutto cio' che mostra un nome va ridisegnato.
  search();
  if (state.cardsReady) searchCards();
  if (state.editing) {
    editorRender();
    pickerRender();
  }
  if (state.deck) showDeck(Store.deck(state.deck.deck_num) || state.deck);
}

// ------------------------------------------------- condivisione e stampa

async function copyToClipboard(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    flashMessage(done);
  } catch {
    // Senza permesso negli appunti resta la selezione manuale.
    window.prompt("Copia con Ctrl+C:", text);
  }
}

let messageTimer = null;
function flashMessage(text) {
  let box = $("#toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    box.className = "toast";
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => box.classList.remove("show"), 2200);
}

function shareLink(deck) {
  return location.origin + location.pathname + Store.deckToHash(deck);
}

/** Decklist pronta da stampare, in una finestra pulita. */
function printDecklist(deck) {
  const zones = [
    ["Main Deck", deck.main],
    ["Extra Deck", deck.extra],
    ["Side Deck", deck.side],
  ];
  const sections = zones
    .filter(([, ids]) => ids && ids.length)
    .map(([title, ids]) => {
      const rows = Store.expand(ids)
        .map(
          (e) =>
            `<tr><td class="q">${e.qty}</td><td>${escapeHtml(e.name)}</td>` +
            `<td class="t">${escapeHtml(e.type || "")}</td></tr>`
        )
        .join("");
      return `<section><h2>${title} <small>${ids.length} carte</small></h2>
        <table><tbody>${rows}</tbody></table></section>`;
    })
    .join("");

  const win = window.open("", "_blank");
  if (!win) return flashMessage("Il browser ha bloccato la finestra di stampa.");
  win.document.write(`<!doctype html><html lang="it"><head>
    <meta charset="utf-8"><title>${escapeHtml(deck.name || "Decklist")}</title>
    <style>
      body { font: 12px/1.45 system-ui, sans-serif; color: #000; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .meta { color: #555; margin: 0 0 18px; font-size: 11px; }
      section { break-inside: avoid; margin-bottom: 16px; }
      h2 { font-size: 13px; margin: 0 0 6px; border-bottom: 1px solid #000;
           padding-bottom: 3px; }
      h2 small { font-weight: normal; color: #555; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 2px 4px; border-bottom: 1px solid #ddd; }
      td.q { width: 28px; font-weight: bold; text-align: right; }
      td.t { width: 34%; color: #555; font-size: 11px; }
      @media print { body { margin: 10mm; } }
    </style></head><body>
    <h1>${escapeHtml(deck.name || "Decklist")}</h1>
    <p class="meta">${escapeHtml(deck.author || "")}${deck.author ? " - " : ""}
      Main ${deck.main.length} - Extra ${deck.extra.length} - Side ${deck.side.length}</p>
    ${sections}
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ----------------------------------------------------- statistiche mazzo

function statsHtml(deck) {
  const s = Store.deckStats(deck);
  if (!s.size) return "";

  const bar = (items, total) =>
    items
      .map(
        (x) =>
          `<div class="bar-row"><span class="bar-key">${escapeHtml(String(x.key))}</span>
             <span class="bar-track"><span class="bar-fill"
               style="width:${Math.round((x.count / total) * 100)}%"></span></span>
             <span class="bar-n">${x.count}</span></div>`
      )
      .join("");

  const opening = s.opening
    .map(
      (o) =>
        `<div class="bar-row"><span class="bar-key wide">${escapeHtml(o.name)} <em>x${o.qty}</em></span>
           <span class="bar-track"><span class="bar-fill alt"
             style="width:${Math.round(o.chance * 100)}%"></span></span>
           <span class="bar-n">${Math.round(o.chance * 100)}%</span></div>`
    )
    .join("");

  const maxLevel = Math.max(1, ...s.levels.map((x) => x.count));
  const maxAttr = Math.max(1, ...s.attributes.map((x) => x.count));

  return `
  <section class="zone stats-zone">
    <div class="zone-head"><h3>Statistiche</h3>
      <span class="muted">su ${s.size} carte del Main</span></div>
    <div class="stats-grid">
      ${s.levels.length ? `<div><h4>Livelli</h4>${bar(s.levels, maxLevel)}</div>` : ""}
      ${s.attributes.length ? `<div><h4>Attributi</h4>${bar(s.attributes, maxAttr)}</div>` : ""}
      <div><h4>Probabilita' di aprirla (${s.draws} carte)</h4>${opening}</div>
    </div>
  </section>`;
}

// -------------------------------------------------------- mazzi simili

function similarHtml(deck) {
  const similar = Store.similarDecks(deck, { limit: 6 });
  if (!similar.length) return "";
  const items = similar
    .map(
      (x) => `
      <button class="similar-item" data-num="${x.deck.deck_num}">
        <strong>${escapeHtml(x.deck.name)}</strong>
        <span class="muted">${escapeHtml(x.deck.format || "")} - ${x.shared} carte in comune</span>
      </button>`
    )
    .join("");
  return `
  <section class="zone">
    <div class="zone-head"><h3>Mazzi simili</h3></div>
    <div class="similar-list">${items}</div>
  </section>`;
}

// ------------------------------------------------------------- editor

const EMPTY_DECK = () => ({ id: null, name: "", main: [], extra: [], side: [] });

function editorInit() {
  if (state.editorReady) return;
  const facets = Store.cardFacets();
  const sel = $("#pAttribute");
  sel.innerHTML = '<option value="">Ogni attributo</option>';
  for (const a of facets.attributes) {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    sel.appendChild(opt);
  }
  if (!Store.storageWorks()) {
    $("#edSave").disabled = true;
    $("#edSave").title =
      "Il browser non permette di salvare in locale (navigazione privata?). " +
      "Puoi comunque scaricare il .ydk.";
  }
  state.editorReady = true;
}

/** Carica un mazzo nell'editor, sistemando le carte fuori posto. */
function editorLoad(deck, { keepId = false } = {}) {
  const { deck: tidy, moved } = Store.tidyDeck(deck);
  state.editing = {
    id: keepId ? deck.id || null : null,
    name: deck.name || "",
    main: tidy.main,
    extra: tidy.extra,
    side: tidy.side,
  };
  $("#edName").value = state.editing.name;
  state.history = [];
  state.movedNote = moved.length
    ? `${moved.length} cart${moved.length > 1 ? "e sono state spostate" : "a e' stata spostata"} nella zona corretta.`
    : "";
  editorRender();
}

/** Fotografia del mazzo prima di una modifica, per poterla annullare. */
function editorSnapshot() {
  const d = state.editing;
  state.history.push(JSON.stringify([d.main, d.extra, d.side]));
  if (state.history.length > 50) state.history.shift();
}

function editorUndo() {
  const previous = state.history.pop();
  if (!previous) return;
  const [main, extra, side] = JSON.parse(previous);
  Object.assign(state.editing, { main, extra, side });
  state.movedNote = "";
  editorRender();
}

function editorRender() {
  const deck = state.editing;
  const format = $("#edFormat") ? $("#edFormat").value : "";
  const check = Store.validateDeck(deck, format);
  if ($("#edUndo")) $("#edUndo").disabled = !state.history.length;

  $("#edCounts").innerHTML = ["main", "extra", "side"]
    .map((zone) => {
      const limit = Store.limits[zone];
      const n = check.counts[zone];
      const bad = n > limit.max || n < limit.min;
      const label = { main: "Main", extra: "Extra", side: "Side" }[zone];
      return `<span class="count-pill${bad ? " bad" : " good"}">${label} ${n}<small>/${limit.max}</small></span>`;
    })
    .join("");

  const problems = [...check.errors];
  if (state.movedNote) problems.unshift(state.movedNote);
  const box = $("#edErrors");
  box.classList.toggle("hidden", !problems.length);
  box.innerHTML = problems.map((e) => `<div>${escapeHtml(e)}</div>`).join("");

  for (const zone of ["main", "extra", "side"]) {
    const grid = document.querySelector(`[data-grid="${zone}"]`);
    const entries = Store.expand(deck[zone]);
    grid.innerHTML = entries.map((e) => editorTile(e, zone)).join("");
    document.querySelector(`[data-count="${zone}"]`).textContent =
      `${deck[zone].length} carte`;
  }
  $("#edDownload").disabled = !deck.main.length;
}

function editorTile(e, zone) {
  return `
  <div class="card-tile" data-id="${e.id}" data-zone="${zone}" role="button" tabindex="0"
       title="${escapeHtml(e.name)} - clicca per togliere una copia">
    <img loading="lazy" src="${imgUrl(e.id)}" alt="${escapeHtml(e.name)}"
         data-card-id="${e.id}" onerror="Store.imgFallback(this)">
    <span class="qty">x${e.qty}</span>
    <div class="cname">${escapeHtml(e.name)}</div>
  </div>`;
}

function editorAdd(id, toSide) {
  const deck = state.editing;
  const zone = toSide ? "side" : Store.zoneFor(id);
  const max = Store.banLimit(id, $("#edFormat").value);
  if (Store.copiesOf(deck, id) >= max) {
    const limite = Store.banLimit(id, $("#edFormat").value);
    return editorFlash(
      limite < 3
        ? `Questa carta e' ${Store.banStatus(id, $("#edFormat").value).label} in questo formato.`
        : "Hai gia' tre copie di questa carta."
    );
  }
  if (deck[zone].length >= Store.limits[zone].max) {
    const label = { main: "Il Main", extra: "L'Extra", side: "Il Side" }[zone];
    return editorFlash(`${label} Deck e' al massimo.`);
  }
  editorSnapshot();
  deck[zone].push(id);
  state.movedNote = "";
  editorRender();
  renderSuggestions();
}

function editorRemove(id, zone) {
  const list = state.editing[zone];
  const at = list.lastIndexOf(id);
  if (at < 0) return;
  editorSnapshot();
  list.splice(at, 1);
  state.movedNote = "";
  editorRender();
}

let flashTimer = null;
function editorFlash(message) {
  const box = $("#edErrors");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="flash">${escapeHtml(message)}</div>`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(editorRender, 2200);
}

function renderSuggestions() {
  const box = $("#edSuggest");
  if (!box) return;
  const deck = state.editing;
  const seeds = [...deck.main, ...deck.extra];
  if (seeds.length < 3) {
    box.classList.add("hidden");
    return;
  }
  // Le carte piu' rappresentative sono quelle che il mazzo ripete.
  const counts = new Map();
  for (const id of seeds) counts.set(id, (counts.get(id) || 0) + 1);
  const seeds2 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const found = Store.suggestCards(seeds2, { limit: 10 });
  if (!found.length) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  $("#edSuggestList").innerHTML = found
    .map(
      (x) => `
      <button class="suggest-item" data-id="${x.id}" title="In ${x.decks} mazzi con queste carte">
        <img loading="lazy" src="${imgUrl(x.id)}" alt=""
             data-card-id="${x.id}" onerror="Store.imgFallback(this)">
        <span class="suggest-name">${escapeHtml(x.name)}</span>
        <span class="muted">${Math.round(x.share * 100)}%</span>
      </button>`
    )
    .join("");
  $("#edSuggestList").querySelectorAll(".suggest-item").forEach((b) =>
    b.addEventListener("click", () => editorAdd(Number(b.dataset.id), false))
  );
}

// ---------------------------------------------------- scelta delle carte

function pickerFilters() {
  return {
    q: $("#pQuery").value.trim(),
    group: $("#pGroup").value,
    attribute: $("#pAttribute").value,
    archetype: $("#pArchetype").value.trim(),
    sort: "decks",
    page: state.pickerPage,
    perPage: 24,
  };
}

function pickerRender() {
  const data = Store.searchCards(pickerFilters());
  state.pickerPage = data.page;
  $("#pPageLabel").textContent = `${data.page} / ${data.pages}`;
  $("#pPrev").disabled = data.page <= 1;
  $("#pNext").disabled = data.page >= data.pages;

  $("#pickerGrid").innerHTML = data.items
    .map((c) => {
      const have = Store.copiesOf(state.editing, c.id);
      return `
      <div class="picker-tile${have ? " has" : ""}" data-id="${c.id}"
           title="${escapeHtml(c.name)}">
        <img loading="lazy" src="${imgUrl(c.id)}" alt="${escapeHtml(c.name)}"
             data-card-id="${c.id}" onerror="Store.imgFallback(this)">
        ${have ? `<span class="qty">x${have}</span>` : ""}
        <button class="to-side" data-side="${c.id}" title="Aggiungi al Side Deck">S</button>
        <div class="cname">${escapeHtml(c.name)}</div>
      </div>`;
    })
    .join("");
}

function renderSavedDecks() {
  const list = Store.savedDecks();
  const box = $("#edMineList");
  if (!list.length) {
    box.innerHTML = '<p class="hint">Nessun mazzo salvato. Premi "Salva" per tenerne uno.</p>';
    return;
  }
  box.innerHTML = list
    .map(
      (d) => `
      <div class="saved-item">
        <button class="saved-open" data-id="${d.id}">
          <strong>${escapeHtml(d.name)}</strong>
          <span class="muted">Main ${d.main.length} - Extra ${d.extra.length} - Side ${d.side.length}</span>
        </button>
        <button class="saved-del btn btn-ghost" data-del="${d.id}" title="Elimina">&times;</button>
      </div>`
    )
    .join("");
  box.querySelectorAll(".saved-open").forEach((b) =>
    b.addEventListener("click", () => {
      const deck = Store.savedDecks().find((d) => d.id === b.dataset.id);
      if (deck) {
        editorLoad(deck, { keepId: true });
        $("#edMinePanel").classList.add("hidden");
      }
    })
  );
  box.querySelectorAll(".saved-del").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Eliminare questo mazzo salvato?")) return;
      Store.deleteSavedDeck(b.dataset.del);
      if (state.editing && state.editing.id === b.dataset.del) state.editing.id = null;
      renderSavedDecks();
    })
  );
}


// ----------------------------------------------------- vista archetipi

function renderArchetypeList() {
  const q = $("#aQuery").value.trim().toLowerCase();
  const all = Store.archetypeList().filter(
    (a) => !q || a.name.toLowerCase().includes(q)
  );

  $("#archList").classList.remove("hidden");
  $("#archDetail").classList.add("hidden");
  $("#aBack").classList.add("hidden");

  if (!all.length) {
    $("#archList").innerHTML = '<p class="empty">Nessun archetipo trovato.</p>';
    return;
  }
  $("#archList").innerHTML = all
    .map(
      (a) => `
      <button class="arch-item" data-name="${escapeHtml(a.name)}">
        <strong>${escapeHtml(a.name)}</strong>
        <span class="muted">${a.count} mazz${a.count > 1 ? "i" : "o"}</span>
      </button>`
    )
    .join("");
  $("#archList")
    .querySelectorAll(".arch-item")
    .forEach((b) =>
      b.addEventListener("click", () => openArchetype(b.dataset.name))
    );
}

function openArchetype(name) {
  const p = Store.archetypeProfile(name);
  if (!p) return;
  state.archetype = name;
  showView("archetipi");

  $("#archList").classList.add("hidden");
  $("#aBack").classList.remove("hidden");
  const box = $("#archDetail");
  box.classList.remove("hidden");

  const chips = (items, label) =>
    items.length
      ? `<div class="arch-facet"><h4>${label}</h4><div class="tags">` +
        items
          .map(
            (x) =>
              `<span class="tag">${escapeHtml(x.label || x.key)} <em>${x.count}</em></span>`
          )
          .join("") +
        `</div></div>`
      : "";

  const partners = p.partners.length
    ? `<div class="arch-facet"><h4>Spesso insieme a</h4><div class="tags">` +
      p.partners
        .map(
          (x) =>
            `<button class="tag link" data-arch="${escapeHtml(x.key)}">${escapeHtml(x.key)} <em>${x.count}</em></button>`
        )
        .join("") +
      `</div></div>`
    : "";

  const cards = p.cards
    .map(
      (c) => `
      <div class="card-tile" data-card="${c.id}" role="button" tabindex="0"
           title="${escapeHtml(c.name)}">
        <img loading="lazy" src="${imgUrl(c.id)}" alt="${escapeHtml(c.name)}"
             data-card-id="${c.id}" onerror="Store.imgFallback(this)">
        ${c.inArchetype ? `<span class="qty">${c.inArchetype}</span>` : ""}
        <div class="cname">${escapeHtml(c.name)}</div>
      </div>`
    )
    .join("");

  const decks = p.topDecks
    .map(
      (d) => `
      <button class="similar-item" data-num="${d.deck_num}">
        <strong>${escapeHtml(d.name)}</strong>
        <span class="muted">${escapeHtml(d.format || "")}${d.author ? " - " + escapeHtml(d.author) : ""}</span>
      </button>`
    )
    .join("");

  box.innerHTML = `
    <header class="arch-head">
      <h2>${escapeHtml(p.name)}</h2>
      <p class="muted">${p.cardCount} carte dell'archetipo - giocato in ${p.deckCount} mazzi</p>
      <button id="aSeeDecks" class="btn btn-primary">Vedi tutti i mazzi</button>
    </header>
    <div class="arch-facets">
      ${chips(p.formats, "Dove si gioca")}
      ${chips(p.strategies, "Come funziona")}
      ${partners}
    </div>
    ${cards ? `<section class="zone"><div class="zone-head"><h3>Le sue carte</h3>
       <span class="muted">il numero e' in quanti mazzi dell'archetipo compare</span></div>
       <div class="card-grid">${cards}</div></section>` : ""}
    ${decks ? `<section class="zone"><div class="zone-head"><h3>Mazzi</h3></div>
       <div class="similar-list">${decks}</div></section>` : ""}`;

  box.querySelectorAll("[data-card]").forEach((el) =>
    el.addEventListener("click", () => openCard(cardEntry(Number(el.dataset.card))))
  );
  box.querySelectorAll(".similar-item").forEach((b) =>
    b.addEventListener("click", () => openDeck(Number(b.dataset.num)))
  );
  box.querySelectorAll("[data-arch]").forEach((b) =>
    b.addEventListener("click", () => openArchetype(b.dataset.arch))
  );
  const seeAll = $("#aSeeDecks");
  if (seeAll) {
    seeAll.addEventListener("click", () => {
      state.cardFilter = null;
      showView("decks");
      $("#fQuery").value = "";
      $("#fFormat").value = "";
      $("#fStrategy").value = "";
      $("#fArchetype").value = p.name;
      state.page = 1;
      search();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// --------------------------------------------------------- vista carte

const VIEWS = {
  decks: "#viewDecks", cards: "#viewCards",
  archetipi: "#viewArch", editor: "#viewEditor",
};
const TABS = {
  decks: "#tabDecks", cards: "#tabCards",
  archetipi: "#tabArch", editor: "#tabEditor",
};

function showView(name) {
  for (const [key, sel] of Object.entries(VIEWS)) {
    $(sel).classList.toggle("hidden", key !== name);
  }
  for (const [key, sel] of Object.entries(TABS)) {
    $(sel).classList.toggle("active", key === name);
    $(sel).setAttribute("aria-selected", String(key === name));
  }
  // La modalita' casuale riguarda i mazzi: fuori da li' non ha senso.
  if (name !== "decks") $("#randomPanel").classList.add("hidden");
  $("#btnRandomMode").classList.toggle("hidden", name !== "decks");
  state.view = name;

  if (name === "cards") {
    if (!state.cardsReady) {
      fillCardFilters();
      state.cardsReady = true;
    }
    searchCards();
  }
  if (name === "archetipi" && !state.archetype) renderArchetypeList();
  if (name === "editor") {
    editorInit();
    if (!state.editing) editorLoad(EMPTY_DECK());
    else editorRender();
    pickerRender();
    renderSuggestions();
  }
}

function fillCardFilters() {
  const facets = Store.cardFacets();
  const fill = (sel, values, label) => {
    const el = $(sel);
    const kept = el.value;
    el.innerHTML = `<option value="">${label}</option>`;
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    }
    el.value = kept;
  };
  fill("#cAttribute", facets.attributes, "Ogni attributo");
  fill("#cRace", facets.races, "Ogni tipo");
  fill("#cLevel", facets.levels, "Ogni livello");
}

function cardFilters() {
  return {
    q: $("#cQuery").value.trim(),
    group: $("#cGroup").value,
    attribute: $("#cAttribute").value,
    race: $("#cRace").value,
    level: $("#cLevel").value,
    archetype: $("#cArchetype").value.trim(),
    sort: $("#cSort").value,
    page: state.cardPage,
    perPage: 36,
  };
}

function searchCards() {
  const data = Store.searchCards(cardFilters());
  state.cardPage = data.page;

  $("#cCount").textContent = data.total
    ? `${data.total.toLocaleString("it-IT")} carte trovate`
    : "";
  $("#cPageLabel").textContent = `${data.page} / ${data.pages}`;
  $("#cPrev").disabled = data.page <= 1;
  $("#cNext").disabled = data.page >= data.pages;

  const grid = $("#cardGrid");
  grid.innerHTML = data.items.map(browseCard).join("");
  grid.querySelectorAll(".browse-tile").forEach((el) => {
    el.addEventListener("click", () => openCard(cardEntry(Number(el.dataset.id))));
  });

  const empty = $("#cEmpty");
  empty.textContent = "Nessuna carta corrisponde ai filtri.";
  empty.classList.toggle("hidden", Boolean(data.total));
}

function browseCard(c) {
  const used = c._deckCount
    ? `<span class="used">${c._deckCount} mazz${c._deckCount > 1 ? "i" : "o"}</span>`
    : '<span class="used none">nessun mazzo</span>';
  return `
  <article class="browse-tile" data-id="${c.id}" role="button" tabindex="0"
           title="${escapeHtml(c.name)}">
    <img loading="lazy" src="${imgUrl(c.id)}" alt="${escapeHtml(c.name)}"
         data-card-id="${c.id}" onerror="Store.imgFallback(this)">
    <div class="browse-name">${escapeHtml(c.name)}</div>
    ${used}
  </article>`;
}

/** Una carta fuori da un mazzo: stessa forma delle voci del mazzo. */
function cardEntry(id) {
  const entry = Store.expand([id])[0];
  if (entry) entry.qty = 0;          // non e' in un mazzo: niente conteggio
  return entry;
}

/** Dalla scheda della carta ai mazzi che la usano. */
function decksWithCurrentCard(id, name) {
  state.cardFilter = { id, name };
  closeCard();
  closeDeck();
  showView("decks");
  $("#fQuery").value = "";
  $("#fFormat").value = "";
  $("#fArchetype").value = "";
  $("#fStrategy").value = "";
  state.page = 1;
  search();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearCardFilter() {
  state.cardFilter = null;
  state.page = 1;
  search();
}

// --------------------------------------------------------- scheda carta

// I mostri Link non hanno livello ne' difesa, gli Xyz hanno il rango al
// posto del livello: la riga va costruita in base al tipo di carta.
const ARROWS = {
  "Top-Left": "\u2196", Top: "\u2191", "Top-Right": "\u2197",
  Left: "\u2190", Right: "\u2192",
  "Bottom-Left": "\u2199", Bottom: "\u2193", "Bottom-Right": "\u2198",
};
const ARROW_ORDER = [
  "Top-Left", "Top", "Top-Right",
  "Left", null, "Right",
  "Bottom-Left", "Bottom", "Bottom-Right",
];

function linkArrows(markers) {
  if (!markers || !markers.length) return "";
  const cells = ARROW_ORDER.map((key) => {
    if (key === null) return '<span class="arrow mid"></span>';
    const on = markers.includes(key);
    return `<span class="arrow${on ? " on" : ""}">${on ? ARROWS[key] : ""}</span>`;
  }).join("");
  return `<div class="arrows" title="Frecce Link">${cells}</div>`;
}

function statRows(c) {
  const kind = (c.type || "").toLowerCase();
  const frame = (c.frame_type || "").toLowerCase();
  const rows = [];

  if (c.group === "Mostri") {
    if (c.attribute) rows.push(["Attributo", c.attribute]);
    if (c.race) rows.push(["Tipo", c.race]);
    if (c.linkval != null) rows.push(["Link", "LINK-" + c.linkval]);
    else if (frame.includes("xyz")) rows.push(["Rango", c.level]);
    else if (c.level != null) rows.push(["Livello", c.level]);
    if (c.scale != null) rows.push(["Scala Pendulum", c.scale]);
    if (c.atk != null) rows.push(["ATK", c.atk]);
    // Un Link non ha difesa: mostrare "0" sarebbe sbagliato.
    if (c.linkval == null && c.defense != null) rows.push(["DEF", c.defense]);
  } else if (c.race) {
    // Per magie e trappole "race" e' il sottotipo: Continua, Rapida...
    rows.push([kind.includes("trap") ? "Trappola" : "Magia", c.race]);
  }

  if (c.archetype) rows.push(["Archetipo", c.archetype, "archetipo"]);
  rows.push(["Passcode", c.id]);
  return rows;
}

function openCard(entry) {
  if (!entry) return;
  const inDeck = entry.qty
    ? `<span class="card-qty">${entry.qty} cop${entry.qty > 1 ? "ie" : "ia"} nel mazzo</span>`
    : "";

  const rows = statRows(entry)
    .map(([label, value, action]) =>
      action === "archetipo"
        ? `<div class="stat"><dt>${escapeHtml(label)}</dt><dd>` +
            `<button class="link-like" data-arch="${escapeHtml(value)}">${escapeHtml(value)}</button></dd></div>`
        : `<div class="stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )
    .join("");

  const text = entry.descr
    ? `<div class="card-text">${escapeHtml(entry.descr).replace(/\n/g, "<br>")}</div>`
    : '<p class="muted">Testo non disponibile.</p>';

  $("#cardBody").innerHTML = `
    <div class="card-art">
      <img src="${imgUrl(entry.id, "full")}" alt="${escapeHtml(entry.name)}"
           data-card-id="${entry.id}" data-card-size="full"
           onerror="Store.imgFallback(this)">
    </div>
    <div class="card-info">
      <h2>${escapeHtml(entry.name)}</h2>
      <p class="card-kind">${escapeHtml(entry.type || "")}${inDeck}</p>
      ${linkArrows(entry.link_markers)}
      <dl class="stats">${rows}</dl>
      ${text}
      <button class="btn btn-primary card-decks" data-id="${entry.id}"
              data-name="${escapeHtml(entry.name)}">
        Mazzi con questa carta (${Store.cardDeckCount(entry.id)})
      </button>
    </div>`;
  const btn = $("#cardBody .card-decks");
  btn.disabled = !Store.cardDeckCount(entry.id);
  btn.addEventListener("click", () =>
    decksWithCurrentCard(Number(btn.dataset.id), btn.dataset.name)
  );
  const archBtn = $("#cardBody [data-arch]");
  if (archBtn) {
    archBtn.addEventListener("click", () => {
      closeCard();
      closeDeck();
      openArchetype(archBtn.dataset.arch);
    });
  }
  $("#cardOverlay").classList.remove("hidden");
}

function closeCard() {
  $("#cardOverlay").classList.add("hidden");
}

/** Dalla tessera cliccata alla voce carta gia' calcolata per il mazzo. */
function entryFromTile(tile) {
  const id = Number(tile.dataset.id);
  const deck = state.deck;
  if (!deck) return null;
  return (
    [...deck.main_cards, ...deck.extra_cards, ...deck.side_cards].find(
      (e) => e.id === id
    ) || null
  );
}

function closeDeck() {
  $("#overlay").classList.add("hidden");
  state.deck = null;
}

function downloadYdk() {
  if (state.deck) Store.downloadYdk(state.deck);
}

function previewYdk() {
  if (!state.deck) return;
  $("#deckBody").innerHTML =
    `<div class="zone"><div class="zone-head"><h3>${escapeHtml(
      state.deck.ydk_filename
    )}</h3><span class="muted">anteprima del file</span></div>` +
    `<pre class="ydk-text">${escapeHtml(state.deck.ydk)}</pre></div>`;
}

// ------------------------------------------------------------- update DB

async function startUpdate() {
  const formats = Array.from(
    $("#optFormats").querySelectorAll("input:checked")
  ).map((el) => el.value);

  const payload = {
    pages_per_format: Number($("#optPages").value) || 5,
    with_cards: $("#optCards").checked,
  };
  if (formats.length) payload.formats = formats;

  $("#btnUpdate").disabled = true;
  $("#progress").classList.remove("hidden");
  try {
    await api("api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    $("#progressMsg").textContent = "Errore: " + err.message;
    $("#btnUpdate").disabled = false;
    return;
  }
  startPolling();
}

function startPolling() {
  if (state.pollTimer) return;
  $("#progress").classList.remove("hidden");
  $("#btnUpdate").disabled = true;
  state.pollTimer = setInterval(pollUpdate, 900);
  pollUpdate();
}

const PHASES = {
  cards: "Scarico le carte",
  decks: "Scarico i mazzi",
  tagforce: "Importo i mazzi Tag Force",
  sides: "Recupero i side deck",
  strategies: "Riconosco il funzionamento",
  export: "Preparo i dati",
  done: "Completato",
  error: "Errore",
  starting: "Avvio",
  idle: "In attesa",
};

async function pollUpdate() {
  let u;
  try {
    u = await api("api/update");
  } catch {
    return;
  }

  const pct = u.total ? Math.round((u.done / u.total) * 100) : 0;
  $("#progressBar").style.width = pct + "%";
  $("#progressPhase").textContent = PHASES[u.phase] || u.phase;
  $("#progressCount").textContent = u.total
    ? `${u.done}/${u.total} · ${u.decks_saved} mazzi · ${pct}%`
    : "";
  $("#progressMsg").textContent = u.error || u.message || "";
  const log = $("#progressLog");
  log.textContent = (u.log || []).join("\n");
  log.scrollTop = log.scrollHeight;

  if (!u.running) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    $("#btnUpdate").disabled = false;
    $("#progressBar").style.width = u.error ? pct + "%" : "100%";
    // L'aggiornamento ha riscritto i JSON: ricaricali.
    await Store.load();
    showStats();
    loadFilters();
    search();
    if (!u.error) setTimeout(() => $("#progress").classList.add("hidden"), 4000);
  }
}

// ------------------------------------------------------------- eventi

let searchTimer = null;
function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    search();
  }, 200);
}

function init() {
  $("#btnUpdate").addEventListener("click", startUpdate);
  $("#btnUpdateOpts").addEventListener("click", () => {
    $("#updatePanel").classList.toggle("hidden");
    fillUpdateFormats();
  });

  $("#fQuery").addEventListener("input", debouncedSearch);
  $("#fArchetype").addEventListener("input", debouncedSearch);
  for (const id of ["#fFormat", "#fStrategy", "#fSort"]) {
    $(id).addEventListener("change", () => {
      state.page = 1;
      search();
    });
  }
  $("#btnReset").addEventListener("click", () => {
    state.cardFilter = null;
    $("#fQuery").value = "";
    $("#fFormat").value = "";
    $("#fArchetype").value = "";
    $("#fStrategy").value = "";
    $("#fSort").value = "recent";
    state.page = 1;
    search();
  });

  $("#btnPrev").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      search();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  $("#btnNext").addEventListener("click", () => {
    state.page += 1;
    search();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("#btnRandomMode").addEventListener("click", () => {
    const panel = $("#randomPanel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) updatePool();
  });
  $("#rndFormats").addEventListener("change", updatePool);
  $("#rndStrategies").addEventListener("change", updatePool);
  $("#rndArchetypeInput").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const value = ev.target.value.trim();
    if (value && !state.randomArchetypes.includes(value)) {
      state.randomArchetypes.push(value);
      renderChips();
      updatePool();
    }
    ev.target.value = "";
  });
  $("#btnDraw").addEventListener("click", drawRandom);
  $("#btnReroll").addEventListener("click", drawRandom);
  $("#btnRandomReset").addEventListener("click", () => {
    $("#rndFormats").selectedIndex = -1;
    $("#rndStrategies").selectedIndex = -1;
    state.randomArchetypes = [];
    renderChips();
    updatePool();
  });

  $("#deckBody").addEventListener("click", (ev) => {
    const tile = ev.target.closest(".card-tile");
    if (tile) openCard(entryFromTile(tile));
  });
  $("#deckBody").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const tile = ev.target.closest(".card-tile");
    if (tile) {
      ev.preventDefault();
      openCard(entryFromTile(tile));
    }
  });
  $("#btnCardClose").addEventListener("click", closeCard);
  $("#cardOverlay").addEventListener("click", (ev) => {
    if (ev.target === $("#cardOverlay")) closeCard();
  });

  $("#btnLang").addEventListener("click", toggleLanguage);

  // --- condivisione dalla scheda del mazzo ---
  $("#btnYdke").addEventListener("click", () =>
    state.deck && copyToClipboard(Store.buildYdke(state.deck), "Codice ydke copiato.")
  );
  $("#btnLink").addEventListener("click", () =>
    state.deck && copyToClipboard(shareLink(state.deck), "Link copiato.")
  );
  $("#btnPrint").addEventListener("click", () => state.deck && printDecklist(state.deck));

  // --- condivisione dall'editor ---
  $("#edYdke").addEventListener("click", () =>
    copyToClipboard(Store.buildYdke(state.editing), "Codice ydke copiato.")
  );
  $("#edLink").addEventListener("click", () =>
    copyToClipboard(shareLink(state.editing), "Link copiato.")
  );
  $("#edPrint").addEventListener("click", () => printDecklist(state.editing));
  $("#edPasteYdke").addEventListener("click", () => {
    const text = window.prompt("Incolla qui il codice ydke://");
    if (!text) return;
    const parsed = Store.parseYdke(text);
    if (!parsed) return editorFlash("Non sembra un codice ydke valido.");
    parsed.name = state.editing.name || "Mazzo incollato";
    editorLoad(parsed);
    renderSuggestions();
  });
  $("#edFormat").addEventListener("change", () => {
    editorRender();
    pickerRender();
  });
  $("#edUndo").addEventListener("click", editorUndo);
  $("#edSuggestRefresh").addEventListener("click", renderSuggestions);

  $("#tabDecks").addEventListener("click", () => showView("decks"));
  $("#tabCards").addEventListener("click", () => showView("cards"));
  $("#tabArch").addEventListener("click", () => {
    state.archetype = null;
    showView("archetipi");
    renderArchetypeList();
  });
  $("#tabEditor").addEventListener("click", () => showView("editor"));
  $("#aBack").addEventListener("click", () => {
    state.archetype = null;
    renderArchetypeList();
  });
  let archTimer = null;
  $("#aQuery").addEventListener("input", () => {
    clearTimeout(archTimer);
    archTimer = setTimeout(() => {
      state.archetype = null;
      renderArchetypeList();
    }, 200);
  });

  // --- editor ---
  $("#edName").addEventListener("input", (ev) => {
    if (state.editing) state.editing.name = ev.target.value;
  });
  $("#edNew").addEventListener("click", () => {
    if (state.editing && state.editing.main.length &&
        !confirm("Vuoi davvero svuotare il mazzo in corso?")) return;
    editorLoad(EMPTY_DECK());
  });
  $("#edImport").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const parsed = Store.parseYdk(await file.text());
      parsed.name = parsed.name || file.name.replace(/\.ydk$/i, "");
      editorLoad(parsed);
      showView("editor");
    } catch (err) {
      editorFlash("Non riesco a leggere il file: " + err.message);
    }
    ev.target.value = "";          // cosi' si puo' ricaricare lo stesso file
  });
  $("#edSave").addEventListener("click", () => {
    const saved = Store.saveDeck(state.editing);
    if (!saved) return editorFlash("Salvataggio non riuscito.");
    state.editing.id = saved.id;
    renderSavedDecks();
    editorFlash("Mazzo salvato.");
  });
  $("#edDownload").addEventListener("click", () => {
    const deck = state.editing;
    Store.downloadYdk({
      deck_num: deck.id || "nuovo",
      name: deck.name || "Mazzo senza nome",
      author: deck.author || "",
      main: deck.main, extra: deck.extra, side: deck.side,
    });
  });
  $("#edMine").addEventListener("click", () => {
    $("#edMinePanel").classList.toggle("hidden");
    renderSavedDecks();
  });

  document.querySelector(".editor-zones").addEventListener("click", (ev) => {
    const tile = ev.target.closest(".card-tile");
    if (tile) editorRemove(Number(tile.dataset.id), tile.dataset.zone);
  });
  $("#pickerGrid").addEventListener("click", (ev) => {
    const side = ev.target.closest(".to-side");
    if (side) {
      ev.stopPropagation();
      return editorAdd(Number(side.dataset.side), true);
    }
    const tile = ev.target.closest(".picker-tile");
    if (tile) editorAdd(Number(tile.dataset.id), false);
  });

  let pickerTimer = null;
  const pickerDebounced = () => {
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => {
      state.pickerPage = 1;
      pickerRender();
    }, 220);
  };
  $("#pQuery").addEventListener("input", pickerDebounced);
  $("#pArchetype").addEventListener("input", pickerDebounced);
  $("#pGroup").addEventListener("change", () => { state.pickerPage = 1; pickerRender(); });
  $("#pAttribute").addEventListener("change", () => { state.pickerPage = 1; pickerRender(); });
  $("#pPrev").addEventListener("click", () => {
    if (state.pickerPage > 1) { state.pickerPage -= 1; pickerRender(); }
  });
  $("#pNext").addEventListener("click", () => { state.pickerPage += 1; pickerRender(); });

  $("#btnEditDeck").addEventListener("click", () => {
    const d = state.deck;
    if (!d) return;
    closeDeck();
    // Una copia: modificare non deve toccare il mazzo originale.
    editorLoad({
      name: d.name + " (copia)",
      main: [...d.main], extra: [...d.extra], side: [...d.side],
    });
    showView("editor");
  });

  let cardTimer = null;
  const cardsDebounced = () => {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      state.cardPage = 1;
      searchCards();
    }, 220);
  };
  $("#cQuery").addEventListener("input", cardsDebounced);
  $("#cArchetype").addEventListener("input", cardsDebounced);
  for (const id of ["#cGroup", "#cAttribute", "#cRace", "#cLevel", "#cSort"]) {
    $(id).addEventListener("change", () => {
      state.cardPage = 1;
      searchCards();
    });
  }
  $("#cReset").addEventListener("click", () => {
    for (const id of ["#cQuery", "#cGroup", "#cAttribute", "#cRace",
                      "#cLevel", "#cArchetype"]) {
      $(id).value = "";
    }
    $("#cSort").value = "decks";
    state.cardPage = 1;
    searchCards();
  });
  $("#cPrev").addEventListener("click", () => {
    if (state.cardPage > 1) {
      state.cardPage -= 1;
      searchCards();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  $("#cNext").addEventListener("click", () => {
    state.cardPage += 1;
    searchCards();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#cardGrid").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const tile = ev.target.closest(".browse-tile");
    if (tile) {
      ev.preventDefault();
      openCard(cardEntry(Number(tile.dataset.id)));
    }
  });

  $("#btnClose").addEventListener("click", closeDeck);
  $("#btnYdk").addEventListener("click", downloadYdk);
  $("#btnPreview").addEventListener("click", previewYdk);
  $("#overlay").addEventListener("click", (ev) => {
    if (ev.target === $("#overlay")) closeDeck();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    // La scheda carta sta sopra al mazzo: si chiude per prima.
    if (!$("#cardOverlay").classList.contains("hidden")) return closeCard();
    if (!$("#overlay").classList.contains("hidden")) closeDeck();
  });

  Store.load()
    .then(() => {
      applyCapabilities();
      applyLanguage();
      showStats();
      loadFilters();
      search();
      // Un mazzo condiviso arriva nell'indirizzo: si apre nell'editor.
      const shared = Store.deckFromHash(location.hash);
      if (shared && shared.main.length) {
        showView("editor");
        editorLoad(shared);
        renderSuggestions();
        flashMessage("Mazzo aperto dal link.");
      }
      if (Store.capabilities.update) {
        api("api/update").then((u) => u.running && startPolling()).catch(() => {});
      }
    })
    .catch((err) => {
      $("#dbStats").textContent = "Errore nel caricamento dei dati: " + err.message;
      $("#emptyState").textContent =
        "Non riesco a leggere data/decks.json. In locale premi \"Aggiorna DB\"; " +
        "sul sito significa che la pubblicazione non e' ancora andata a buon fine.";
      $("#emptyState").classList.remove("hidden");
    });
}

init();
