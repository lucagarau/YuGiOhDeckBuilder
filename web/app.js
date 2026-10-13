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

  const link = $("#linkSource");
  if (deck.source === "tagforce" && deck.source_url) {
    link.href = deck.source_url;
    link.textContent = "Apri sul wiki";
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

  parts.push(zoneHtml("Main Deck", deck.main_cards, deck.main.length));
  parts.push(zoneHtml("Extra Deck", deck.extra_cards, deck.extra.length));
  if (deck.side.length)
    parts.push(zoneHtml("Side Deck", deck.side_cards, deck.side.length));

  $("#deckBody").innerHTML = parts.filter(Boolean).join("");
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
    <div class="card-tile" title="${escapeHtml(e.name)}${
        e.descr ? "\n\n" + escapeHtml(e.descr.slice(0, 300)) : ""
      }">
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

  $("#btnClose").addEventListener("click", closeDeck);
  $("#btnYdk").addEventListener("click", downloadYdk);
  $("#btnPreview").addEventListener("click", previewYdk);
  $("#overlay").addEventListener("click", (ev) => {
    if (ev.target === $("#overlay")) closeDeck();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("#overlay").classList.contains("hidden"))
      closeDeck();
  });

  Store.load()
    .then(() => {
      applyCapabilities();
      showStats();
      loadFilters();
      search();
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
