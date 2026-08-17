const send = (msg) => chrome.runtime.sendMessage(msg);
const el   = (id)  => document.getElementById(id);

const deckName       = el("deckName");
const deckUrl        = el("deckUrl");
const tabPickerWrap  = el("tabPickerWrap");
const tabPicker      = el("tabPicker");
const tabFetchStatus = el("tabFetchStatus");
const addBtn         = el("addBtn");
const addStatus      = el("addStatus");
const syncAllBtn     = el("syncAllBtn");
const syncStatus     = el("syncStatus");
const deckList       = el("deckList");
const emptyDecks     = el("emptyDecks");
const intervalInput  = el("interval");
const enabledInput   = el("enabled");
const showHiragana   = el("showHiragana");
const showFurigana   = el("showFurigana");
const swatches       = document.querySelectorAll(".swatch");
const posButtons     = document.querySelectorAll(".pos-btn");
const modeBtns       = document.querySelectorAll(".mode-btn");
const appearanceBtns = document.querySelectorAll(".appearance-btn");

function timeAgo(ts) {
  if (!ts) return "not synced yet";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

function setStatus(node, text, kind) {
  node.textContent = text;
  node.className   = "status" + (kind ? " " + kind : "");
}

// l = light-mode accent, dk = dark-mode accent (must stay legible on the
// dark surface — see the contrast audit in TODO.md), d = darker shade of
// the light accent (feeds --shu-d, a hover/emphasis shade, not mode-related).
const THEME_COLORS = {
  blue:   { l: "#2563eb", dk: "#3b82f6", d: "#1d4ed8" },
  red:    { l: "#d34533", dk: "#e06a55", d: "#b23a26" },
  purple: { l: "#7c3aed", dk: "#a78bfa", d: "#6d28d9" },
  green:  { l: "#16a34a", dk: "#4ade80", d: "#15803d" },
};

let currentTheme = "blue";
let currentColorMode = "system"; // "system" | "light" | "dark" — settings.colorMode

// Resolves "system" against the OS preference right now. Not cached: called
// fresh each time so a live OS theme change (see the matchMedia listener
// below) is picked up correctly.
function isDarkActive() {
  if (currentColorMode === "dark") return true;
  if (currentColorMode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Sets --shu via inline style (not CSS), so it must be told explicitly which
// mode is active — unlike the plain [data-theme] neutrals in options.css,
// this can't fall back to a stylesheet rule automatically.
function applyActiveTheme(theme) {
  currentTheme = theme;
  swatches.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  const t = THEME_COLORS[theme] || THEME_COLORS.blue;
  document.documentElement.style.setProperty("--shu", isDarkActive() ? t.dk : t.l);
  document.documentElement.style.setProperty("--shu-d", t.d);
}

// Single source of truth for light vs dark: always sets an explicit
// data-theme (never left absent), resolving "system" once via matchMedia.
// options.css/vocab-bank.css key every dark-mode rule off [data-theme="dark"]
// — no @media(prefers-color-scheme) left anywhere, so there's nothing else
// to keep in sync.
function applyColorMode(mode) {
  currentColorMode = mode;
  document.documentElement.setAttribute("data-theme", isDarkActive() ? "dark" : "light");
  appearanceBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  applyActiveTheme(currentTheme); // --shu depends on the mode too, re-sync it
}

// Live-update if colorMode is "system" and the OS theme changes while this
// page is open.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentColorMode === "system") applyColorMode("system");
});

function applyActiveMode(mode) {
  modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

function applyActivePos(cardPosition) {
  // Show active preset. If position was custom-dragged (x,y), no button highlighted.
  const preset = cardPosition && cardPosition.preset
    ? cardPosition.preset
    : (!cardPosition || typeof cardPosition.x !== "number") ? "bottom-right" : null;
  posButtons.forEach(b => b.classList.toggle("active", b.dataset.pos === preset));
}

// Which collection row (if any) is mid-rename in the Settings panel —
// mirrors word-editor.js's wEditingGroupId pattern (checkbox/switch stays
// put, only the name label swaps to an input) so re-render never loses state.
let settingsEditingGroupId = null;

async function render() {
  const [state, { cardPosition }] = await Promise.all([
    send({ type: "getState" }),
    chrome.storage.local.get("cardPosition"),
  ]);

  intervalInput.value    = state.settings.intervalMinutes;
  enabledInput.checked   = !!state.settings.enabled;
  showHiragana.checked   = state.settings.showHiragana !== false;
  showFurigana.checked   = !!state.settings.showFurigana;
  currentTheme = state.settings.theme || "blue";
  applyColorMode(state.settings.colorMode || "system"); // also applies the accent (currentTheme)
  applyActivePos(cardPosition);
  applyActiveMode(state.settings.cardMode || "classic");

  deckList.innerHTML = "";
  emptyDecks.style.display = state.categories.length ? "none" : "block";

  for (const cat of state.categories) {
    const isSynced = state.decks.some((d) => d.id === cat.id);
    const count = Object.keys(state.cards[cat.id] || {}).length;
    const li = document.createElement("li");
    li.className = "deck";

    const switchHtml = isSynced
      ? `<label class="switch">
           <input type="checkbox" ${cat.enabled !== false ? "checked" : ""} />
           <span class="slider"></span>
         </label>`
      : "";
    const sub = isSynced ? `${count} cards · synced ${timeAgo(cat.lastSynced)}` : `${count} cards · manual`;
    const nameCell = cat.id === settingsEditingGroupId
      ? `<input type="text" class="group-rename-input" value="${escapeHtml(cat.name)}" style="flex:1" />
         <button type="button" class="group-rename-save" title="Save">&#10003;</button>
         <button type="button" class="group-rename-cancel" title="Cancel">&#10005;</button>`
      : `<div class="name">${escapeHtml(cat.name)}</div>
         <button type="button" class="group-rename-btn" title="Rename">&#9998;</button>`;

    li.innerHTML = `
      ${switchHtml}
      <div class="meta">
        <div class="name-row" style="display:inline-flex;align-items:center;gap:4px;max-width:100%">${nameCell}</div>
        <div class="sub">${sub}</div>
      </div>
      <button class="rm">Delete</button>
    `;

    if (isSynced) {
      li.querySelector("input[type=checkbox]").addEventListener("change", async (e) => {
        await send({ type: "toggleDeck", deckId: cat.id, enabled: e.target.checked });
      });
    }
    const renameBtn = li.querySelector(".group-rename-btn");
    if (renameBtn) renameBtn.addEventListener("click", () => {
      settingsEditingGroupId = cat.id;
      render();
    });
    const cancelBtn = li.querySelector(".group-rename-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => {
      settingsEditingGroupId = null;
      render();
    });
    const saveBtn = li.querySelector(".group-rename-save");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const name = li.querySelector(".group-rename-input").value.trim();
      if (!name) return;
      await send({ type: "renameGroup", groupId: cat.id, name });
      settingsEditingGroupId = null;
      render();
    });
    li.querySelector(".rm").addEventListener("click", async () => {
      if (!confirm(`Delete collection "${cat.name}"? Card progress will be lost.`)) return;
      await send({ type: "removeDeck", deckId: cat.id });
      render();
    });
    deckList.appendChild(li);
  }
}

/* ----------------------- tab picker (add deck form) ----------------------- */

let fetchedTabs    = null;
let deckNameEdited = false;

function resetTabPicker() {
  fetchedTabs = null;
  tabPickerWrap.style.display = "none";
  tabFetchStatus.textContent  = "";
  tabFetchStatus.className    = "status";
}

async function fetchTabs() {
  const url = deckUrl.value.trim();
  if (!url) return;
  if (!url.includes("docs.google.com/spreadsheets")) return;

  resetTabPicker();
  setStatus(tabFetchStatus, "Loading tabs…", "");

  const res = await send({ type: "getSheetTabs", url });

  if (!res.ok || !res.tabs || !res.tabs.length) {
    setStatus(tabFetchStatus,
      res.error || 'Could not load tabs. Make sure the sheet is set to "Anyone with the link can view".',
      "err");
    return;
  }

  fetchedTabs = res.tabs;
  tabFetchStatus.textContent = "";
  tabPicker.innerHTML = "";
  for (const tab of res.tabs) {
    const opt = document.createElement("option");
    opt.value       = tab.name;
    opt.textContent = tab.name;
    tabPicker.appendChild(opt);
  }
  tabPickerWrap.style.display = "block";
  if (!deckNameEdited) deckName.value = res.tabs[0].name;
}

deckUrl.addEventListener("blur",  fetchTabs);
deckUrl.addEventListener("paste", () => setTimeout(fetchTabs, 80));
deckUrl.addEventListener("input", () => { resetTabPicker(); deckNameEdited = false; });

tabPicker.addEventListener("change", () => {
  if (!deckNameEdited) deckName.value = tabPicker.value;
});

deckName.addEventListener("input", () => { deckNameEdited = true; });

addBtn.addEventListener("click", async () => {
  let url = deckUrl.value.trim();
  if (!url) { setStatus(addStatus, "Paste the Google Sheet URL first.", "err"); return; }

  const sheetName = (fetchedTabs && tabPicker.value) ? tabPicker.value : null;

  addBtn.disabled = true;
  setStatus(addStatus, "Adding & syncing…", "");
  const res = await send({ type: "addDeck", name: deckName.value.trim() || "Deck", url, sheetName });
  addBtn.disabled = false;
  if (!res.ok) { setStatus(addStatus, res.error || "Failed to add deck.", "err"); return; }
  if (res.syncError) {
    setStatus(addStatus, "Deck added, but sync failed: " + res.syncError, "err");
  } else {
    setStatus(addStatus, `Added — ${res.added} cards read.`, "ok");
    deckName.value = "";
    deckUrl.value  = "";
    deckNameEdited = false;
    resetTabPicker();
  }
  render();
});

syncAllBtn.addEventListener("click", async () => {
  syncAllBtn.disabled    = true;
  syncAllBtn.textContent = "Syncing…";
  const { results }      = await send({ type: "syncAll" });
  syncAllBtn.disabled    = false;
  syncAllBtn.textContent = "Sync all";
  const failed  = (results || []).filter((r) => !r.ok);
  const added   = (results || []).reduce((s, r) => s + (r.added   || 0), 0);
  const updated = (results || []).reduce((s, r) => s + (r.updated || 0), 0);
  if (!results || !results.length) {
    setStatus(syncStatus, "No decks yet.", "");
  } else if (failed.length) {
    setStatus(syncStatus, `${failed.length} deck(s) failed: ${failed.map((f) => f.name + " (" + f.error + ")").join("; ")}`, "err");
  } else {
    setStatus(syncStatus, `Done — ${added} new, ${updated} updated.`, "ok");
  }
  render();
});

intervalInput.addEventListener("change", async () => {
  let v = parseInt(intervalInput.value, 10);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 240) v = 240;
  intervalInput.value = v;
  await send({ type: "updateSettings", patch: { intervalMinutes: v } });
});

enabledInput.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { enabled: enabledInput.checked } })
);

showHiragana.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { showHiragana: showHiragana.checked } })
);

showFurigana.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { showFurigana: showFurigana.checked } })
);

swatches.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await send({ type: "updateSettings", patch: { theme: btn.dataset.theme } });
    applyActiveTheme(btn.dataset.theme);
  });
});

appearanceBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await send({ type: "updateSettings", patch: { colorMode: btn.dataset.mode } });
    applyColorMode(btn.dataset.mode);
  });
});

modeBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await send({ type: "updateSettings", patch: { cardMode: btn.dataset.mode } });
    applyActiveMode(btn.dataset.mode);
  });
});

posButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    chrome.storage.local.set({ cardPosition: { preset: btn.dataset.pos } });
    posButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

/* ---------------------------------- tabs ---------------------------------- */

const tabBtns  = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

function switchTab(tab) {
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  tabPanes.forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
  if (tab === "stats") renderStats();
  if (tab === "study") renderStudy();
  if (tab === "list" && typeof reloadData === "function") reloadData(); // refresh in case Study just recorded grades
  if (tab === "kanji" && typeof renderKanjiTab === "function") renderKanjiTab();
  if (tab === "graph" && typeof startGraph === "function") startGraph();
  if (tab === "settings") render(); // refresh "Your collections" — a word/collection may have been added elsewhere
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// Open to a specific tab via URL hash (e.g. options.html#study)
const hashTab = window.location.hash.replace("#", "");
if (hashTab) switchTab(hashTab);

/* ---------------------------------- stats --------------------------------- */

let statsState = { categoryId: "__all__" };

async function renderStats() {
  const container = el("statsContent");
  const state     = await send({ type: "getState" });

  if (!state.categories.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No decks yet.</p>';
    return;
  }

  const selectedId = statsState.categoryId || "__all__";
  statsState.categoryId = selectedId;
  const shownCategories = selectedId === "__all__"
    ? state.categories
    : state.categories.filter((c) => c.id === selectedId);

  let html = '<div class="study-toolbar"><label>Category</label><select id="statsCategorySelect" class="tab-select">';
  html += `<option value="__all__"${selectedId === "__all__" ? " selected" : ""}>All categories</option>`;
  for (const cat of state.categories) {
    const sel = selectedId === cat.id ? " selected" : "";
    html += `<option value="${cat.id}"${sel}>${cat.name}</option>`;
  }
  html += '</select></div>';
  container.innerHTML = html;

  document.getElementById("statsCategorySelect").addEventListener("change", (e) => {
    statsState.categoryId = e.target.value;
    renderStats();
  });

  const sectionsWrap = document.createElement("div");
  container.appendChild(sectionsWrap);

  for (const deck of shownCategories) {
    const cards   = state.cards[deck.id] || {};
    const entries = Object.entries(cards);

    const section = document.createElement("div");
    section.className = "stats-deck";

    const hdr = document.createElement("div");
    hdr.className = "stats-deck-header";
    hdr.innerHTML = `<span class="stats-deck-name"></span><span class="stats-deck-count">${entries.length} cards</span>`;
    hdr.querySelector(".stats-deck-name").textContent = deck.name;
    section.appendChild(hdr);

    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "This deck is empty.";
      section.appendChild(p);
      sectionsWrap.appendChild(section);
      continue;
    }

    // Seen cards first (desc), then unseen alphabetically.
    entries.sort((a, b) => {
      const sa = a[1].seen || 0, sb = b[1].seen || 0;
      if (sb !== sa) return sb - sa;
      return a[1].kanji.localeCompare(b[1].kanji);
    });

    const table = document.createElement("table");
    table.className = "stats-table";
    table.innerHTML = `
      <thead><tr>
        <th>Kanji</th><th>Reading</th><th>Meaning</th><th>Shown</th><th>Last seen</th><th>Know</th><th>Hint</th><th>Forgot</th><th>Ratio</th>
      </tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");

    for (const [, card] of entries) {
      const seen  = card.seen   || 0;
      const known = card.known  || 0;
      const hintC = card.hint   || 0;
      const lupa  = card.forgot || 0;
      const total = known + hintC + lupa;
      const pct   = total > 0 ? Math.round((known / total) * 100) : 0;

      const tr = document.createElement("tr");
      if (!seen) tr.className = "cell-muted";

      tr.innerHTML = `
        <td class="kanji-cell"></td>
        <td class="reading-cell"></td>
        <td class="arti-cell"></td>
        <td>${seen || "—"}</td>
        <td>${card.lastSeen ? timeAgo(card.lastSeen) : "—"}</td>
        <td class="${known ? "cell-know"  : "cell-muted"}">${seen ? known : "—"}</td>
        <td class="${hintC ? "cell-hint"  : "cell-muted"}">${seen ? hintC : "—"}</td>
        <td class="${lupa  ? "cell-lupa"  : "cell-muted"}">${seen ? lupa  : "—"}</td>
        <td>${seen
          ? `<span class="ratio-bar"><span class="ratio-fill" style="width:${pct}%"></span></span>${pct}%`
          : '<span class="cell-muted">—</span>'}</td>
      `;
      tr.querySelector(".kanji-cell").textContent   = card.kanji;
      tr.querySelector(".reading-cell").textContent = card.hiragana || "—";
      tr.querySelector(".arti-cell").textContent    = card.arti || "—";
      tbody.appendChild(tr);
    }

    section.appendChild(table);
    sectionsWrap.appendChild(section);
  }
}

/* -------------------------------- study tab ------------------------------- */

let studyState = { cards: [], index: 0, revealed: false, browseOpen: true, done: false, _eligibilityChanged: false };
// The browse/checklist table's own search + category + eligibility filter —
// purely a view filter over the same word list, independent of the Study
// queue above it (see renderStudy()'s big comment for why those two used to
// be tangled). eligibility: "__all__" | "on" | "off" — "on"/"off" mirror the
// same isWordEligible() check the switch column itself uses.
let browseFilter = { categoryId: "__all__", query: "", eligibility: "__all__" };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One entry per unique word, across every category. A word belonging to
// more than one category (shared kanji|hiragana, see core/migrate.js's
// collision handling, or just added to several collections) collects every
// category it belongs to in deckIds instead of showing up as duplicate rows.
function buildStudyEntries(state) {
  const seen = new Map(); // key -> { key, card, deckIds }
  for (const deck of state.categories) {
    for (const [key, c] of Object.entries(state.cards[deck.id] || {})) {
      // Same guard as srs.js's pickCard (see hasVisibleText in core/kanji.js
      // — .trim() alone misses zero-width-only kanji fields) — a word with
      // no visible kanji text has nothing to show on a flashcard, so it
      // shouldn't be queueable here either (the Words tab is where you'd go
      // to fix/delete it, once you notice it's blank).
      if (!hasVisibleText(c.kanji)) continue;
      if (seen.has(key)) seen.get(key).deckIds.push(deck.id);
      else seen.set(key, { key, card: c, deckIds: [deck.id] });
    }
  }
  return [...seen.values()];
}

// Eligible unless explicitly excluded (selection[deckId][key] === false) in
// EVERY one of the word's categories — a missing key means "no opinion yet,
// still eligible," never "excluded." Must match srs.js's pickCard exactly,
// since this is what decides both the Study queue and this checkbox's
// "checked" state.
function isWordEligible(state, entry) {
  return entry.deckIds.some((deckId) => {
    const sel = state.selection[deckId];
    return !(sel && sel[entry.key] === false);
  });
}

// A word shared across decks needs its selection toggled in every one of
// them, or "eligible via any deck" would make the checkbox unable to ever
// turn a shared word off.
async function setWordSelection(entry, selected) {
  for (const deckId of entry.deckIds) {
    await send({ type: "setCardSelection", deckId, key: entry.key, selected });
  }
}

// `state` is needed (not just the entries) to evaluate the eligibility
// filter — isWordEligible() reads state.selection. Both call sites already
// have state in scope (wireBrowseToolbar and renderStudyBrowse are both
// only ever called with it), so this is just threading it one level deeper.
function filterBrowseEntries(entries, filter, state) {
  const q = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.categoryId !== "__all__" && !entry.deckIds.includes(filter.categoryId)) return false;
    if (filter.eligibility !== "__all__") {
      const eligible = isWordEligible(state, entry);
      if (filter.eligibility === "on" && !eligible) return false;
      if (filter.eligibility === "off" && eligible) return false;
    }
    if (q) {
      const c = entry.card;
      const hay = `${c.kanji || ""} ${c.hiragana || ""} ${c.arti || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function renderStudy() {
  const container = el("studyContent");
  const state     = await send({ type: "getState" });

  if (!state.categories.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No decks yet. Add one in Settings.</p>';
    return;
  }

  // "entries" is every word across every category — the Study queue below is
  // always built from all of it. There's no top-level category filter for
  // the queue anymore: which words are IN Study is controlled by the
  // eligibility checkboxes (isWordEligible), full stop. Category/search only
  // filter the browse table (see browseFilter + filterBrowseEntries), a
  // purely cosmetic view over this same list.
  const entries = buildStudyEntries(state);

  if (!entries.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No words yet.</p>';
    return;
  }

  if (!studyState.cards.length || studyState._eligibilityChanged) {
    studyState._eligibilityChanged = false;
    const eligible = entries.filter((entry) => isWordEligible(state, entry));
    const prevKey = studyState.cards[studyState.index]?.key;
    studyState.cards = eligible.map((entry) => ({ key: entry.key, deckIds: entry.deckIds, ...entry.card }));
    const newIdx = prevKey ? studyState.cards.findIndex((c) => c.key === prevKey) : -1;
    studyState.index = newIdx >= 0 ? newIdx : 0;
  }

  let html = "";

  // Session complete screen
  if (studyState.done) {
    html += `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">&#10003;</div>
        <div style="font-size:20px;font-weight:600;margin-bottom:8px">Session complete</div>
        <div style="font-size:14px;color:var(--muted);margin-bottom:24px">All cards reviewed.</div>
        <button class="btn primary" id="restudyBtn" style="min-width:160px">Study again</button>
      </div>`;
    html += browseSectionHtml(state);
    container.innerHTML = html;
    renderStudyBrowse(container, entries, state);
    wireBrowseToolbar(container, entries, state);
    document.getElementById("restudyBtn").addEventListener("click", () => {
      studyState.done = false;
      shuffle(studyState.cards);
      studyState.index = 0;
      studyState.revealed = false;
      renderStudy();
    });
    return;
  }

  if (!studyState.cards.length) {
    html += '<p class="empty" style="margin-top:12px">No words selected. Check some words in the list below to start studying.</p>';
    html += browseSectionHtml(state);
    container.innerHTML = html;
    renderStudyBrowse(container, entries, state);
    wireBrowseToolbar(container, entries, state);
    return;
  }

  const current = studyState.cards[studyState.index];
  const total = studyState.cards.length;

  html += `
    <div class="study-card" id="studyCard">
      <div class="front">
        <div class="front-kanji">${current.kanji}</div>
        ${current.hiragana ? '<div class="front-hint">click to reveal</div>' : ''}
      </div>
      <div class="back ${studyState.revealed ? 'show' : ''}">
        <div class="back-reading">${current.hiragana || ''}</div>
        <div class="back-arti">${current.arti || ''}</div>
        ${current.notes ? `<div class="back-notes">${current.notes}</div>` : ''}
      </div>
    </div>
    <div class="study-actions" id="studyActions">
      <button class="btn" id="studyForgot" ${studyState.revealed ? '' : 'disabled'}>Forgot</button>
      <button class="btn" id="studyHint" ${studyState.revealed ? '' : 'disabled'}>Hint</button>
      <button class="btn primary" id="studyKnow" ${studyState.revealed ? '' : 'disabled'}>Know</button>
    </div>
    <div class="study-nav">
      <button class="btn" id="studyPrev" ${studyState.index > 0 ? '' : 'disabled'}>&larr; Prev</button>
      <span class="study-progress">${studyState.index + 1} / ${total}</span>
      <button class="btn" id="studyNext">Next &rarr;</button>
      <button class="btn" id="studyShuffle">Shuffle</button>
    </div>`;
  html += browseSectionHtml(state);

  container.innerHTML = html;

  renderStudyBrowse(container, entries, state);
  wireBrowseToolbar(container, entries, state);

  document.getElementById("studyCard").addEventListener("click", () => {
    if (!studyState.revealed) {
      studyState.revealed = true;
      renderStudy();
    }
  });

  document.getElementById("studyKnow").addEventListener("click", async () => {
    await send({ type: "grade", deckId: current.deckIds[0], key: current.key, result: "known" });
    advanceStudy();
  });

  document.getElementById("studyHint").addEventListener("click", async () => {
    await send({ type: "grade", deckId: current.deckIds[0], key: current.key, result: "hint" });
    advanceStudy();
  });

  document.getElementById("studyForgot").addEventListener("click", async () => {
    await send({ type: "grade", deckId: current.deckIds[0], key: current.key, result: "forgot" });
    advanceStudy();
  });

  document.getElementById("studyPrev").addEventListener("click", () => {
    if (studyState.index > 0) {
      studyState.done = false;
      studyState.revealed = false;
      studyState.index--;
      renderStudy();
    }
  });

  document.getElementById("studyNext").addEventListener("click", () => {
    advanceStudy();
  });

  document.getElementById("studyShuffle").addEventListener("click", () => {
    studyState.done = false;
    const remaining = studyState.cards.slice(studyState.index);
    shuffle(remaining);
    studyState.cards = [...studyState.cards.slice(0, studyState.index), ...remaining];
    renderStudy();
  });

  document.addEventListener("keydown", studyKeyHandler);
}

// The browse/checklist section's markup: search + category + eligibility
// filter (all view-only, see filterBrowseEntries), Select all / Deselect
// all, and the table itself. Shared by all three renderStudy() branches
// (done screen, empty queue, normal flashcard view) so the checklist is
// always reachable regardless of what the queue above it is doing.
function browseSectionHtml(state) {
  let opts = `<option value="__all__"${browseFilter.categoryId === "__all__" ? " selected" : ""}>All categories</option>`;
  for (const cat of state.categories) {
    opts += `<option value="${cat.id}"${browseFilter.categoryId === cat.id ? " selected" : ""}>${cat.name}</option>`;
  }
  const eligOpts = `
    <option value="__all__"${browseFilter.eligibility === "__all__" ? " selected" : ""}>On &amp; off</option>
    <option value="on"${browseFilter.eligibility === "on" ? " selected" : ""}>On (in study)</option>
    <option value="off"${browseFilter.eligibility === "off" ? " selected" : ""}>Off (excluded)</option>
  `;
  return `
    <details class="study-browse" id="studyBrowse" ${studyState.browseOpen ? 'open' : ''}>
      <summary class="browse-summary" id="browseSummary">Which words show in the popup</summary>
      <p class="hint" style="margin-top:6px">These switches control which words can show up in the flashcard popup
        on web pages, and which ones are in the Study queue above — they're the same list. Leave a word untouched
        and it's eligible by default. Search, Category, and On/Off below only filter this table's view; they don't
        change what's selected.</p>
      <div class="study-browse-toolbar" style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap">
        <input type="text" id="browseSearch" placeholder="Search words…" class="search-input" style="flex:1 1 160px" value="${escapeHtml(browseFilter.query)}" />
        <select id="browseCategorySelect" class="tab-select" style="max-width:180px">${opts}</select>
        <select id="browseEligibleSelect" class="tab-select" style="max-width:150px">${eligOpts}</select>
      </div>
      <div style="margin:8px 0;display:flex;gap:8px">
        <button class="btn" id="selectAllBtn">Select all</button>
        <button class="btn" id="clearSelBtn">Deselect all</button>
      </div>
      <div id="browseTable"></div>
    </details>
  `;
}

function wireBrowseToolbar(container, entries, state) {
  document.getElementById("studyBrowse").addEventListener("toggle", (e) => {
    studyState.browseOpen = e.target.open;
  });

  document.getElementById("browseSearch").addEventListener("input", (e) => {
    browseFilter.query = e.target.value;
    renderStudyBrowse(container, entries, state);
  });

  document.getElementById("browseCategorySelect").addEventListener("change", (e) => {
    browseFilter.categoryId = e.target.value;
    renderStudyBrowse(container, entries, state);
  });

  document.getElementById("browseEligibleSelect").addEventListener("change", (e) => {
    browseFilter.eligibility = e.target.value;
    renderStudyBrowse(container, entries, state);
  });

  document.getElementById("selectAllBtn").addEventListener("click", async () => {
    const visible = filterBrowseEntries(entries, browseFilter, state);
    for (const entry of visible) await setWordSelection(entry, true);
    studyState._eligibilityChanged = true;
    renderStudy();
  });

  document.getElementById("clearSelBtn").addEventListener("click", async () => {
    const visible = filterBrowseEntries(entries, browseFilter, state);
    for (const entry of visible) await setWordSelection(entry, false);
    studyState._eligibilityChanged = true;
    renderStudy();
  });
}

function advanceStudy() {
  studyState.revealed = false;
  if (studyState.index < studyState.cards.length - 1) {
    studyState.index++;
    renderStudy();
  } else {
    studyState.done = true;
    renderStudy();
  }
}

function studyKeyHandler(e) {
  if (!document.getElementById("studyContent") || !document.getElementById("studyContent").offsetParent) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.key) {
    case " ":
      e.preventDefault();
      if (!studyState.revealed) {
        studyState.revealed = true;
        renderStudy();
      }
      break;
    case "ArrowRight":
    case "ArrowDown":
      document.getElementById("studyNext")?.click();
      break;
    case "ArrowLeft":
    case "ArrowUp":
      document.getElementById("studyPrev")?.click();
      break;
    case "1":
      document.getElementById("studyForgot")?.click();
      break;
    case "2":
      document.getElementById("studyHint")?.click();
      break;
    case "3":
      document.getElementById("studyKnow")?.click();
      break;
  }
}

function renderStudyBrowse(container, entries, state) {
  const wrap = document.getElementById("browseTable");
  if (!wrap) return;

  const visible = filterBrowseEntries(entries, browseFilter, state);
  const eligibleCount = visible.filter((entry) => isWordEligible(state, entry)).length;
  const summaryEl = document.getElementById("browseSummary");
  if (summaryEl) {
    summaryEl.textContent = browseFilter.categoryId === "__all__" && !browseFilter.query && browseFilter.eligibility === "__all__"
      ? `Which words show in the popup (${eligibleCount} of ${visible.length} selected)`
      : `Which words show in the popup (${eligibleCount} of ${visible.length} selected in this view)`;
  }

  let html = '<table class="stats-table bank-table"><thead><tr><th>In popup</th><th>Kanji</th><th>Reading</th><th>Meaning</th><th>Notes</th></tr></thead><tbody>';
  if (!visible.length) {
    html += '<tr><td colspan="5" class="empty">No words match.</td></tr>';
  }
  for (const entry of visible) {
    const { key, card: c } = entry;
    const checked = isWordEligible(state, entry) ? 'checked' : '';
    html += `<tr data-key="${key}"><td><label class="switch"><input type="checkbox" class="card-cb" ${checked} /><span class="slider"></span></label></td><td class="kanji-cell">${c.kanji}</td><td class="reading-cell">${c.hiragana || "—"}</td><td>${c.arti || "—"}</td><td class="cell-muted">${c.notes || ""}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll(".card-cb").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const tr = cb.closest("tr");
      const key = tr.dataset.key;
      const entry = entries.find((e) => e.key === key);
      if (entry) await setWordSelection(entry, cb.checked);
      studyState._eligibilityChanged = true;
      renderStudy();
    });
  });

  // Row click (anywhere but the switch) opens the same word detail modal as
  // the Words tab — lets you see the full word and click through to kanji
  // detail without leaving Study to go find it in the bank. Guards on
  // .switch (the wrapping label), not .card-cb (the actual checkbox) — the
  // checkbox itself is visually hidden (options.css's .switch input), so a
  // real click lands on the visible .slider span, a sibling of .card-cb, not
  // a descendant of it. closest(".card-cb") would miss that click entirely
  // and let it fall through to openWordModal below (same bug word-editor.js
  // had with its own switch column — see that file's click guard comment).
  wrap.querySelectorAll("tr[data-key]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".switch")) return;
      const word = allWords.find((w) => w.id === tr.dataset.key);
      if (word) openWordModal(word);
    });
  });
}

render();
