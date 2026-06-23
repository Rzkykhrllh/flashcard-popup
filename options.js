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

const THEME_COLORS = {
  blue:   { l: "#2563eb", d: "#1d4ed8" },
  red:    { l: "#d34533", d: "#b23a26" },
  purple: { l: "#7c3aed", d: "#6d28d9" },
  green:  { l: "#16a34a", d: "#15803d" },
};

function applyActiveTheme(theme) {
  swatches.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  const t = THEME_COLORS[theme] || THEME_COLORS.blue;
  document.documentElement.style.setProperty("--shu", t.l);
  document.documentElement.style.setProperty("--shu-d", t.d);
}

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

async function render() {
  const [state, { cardPosition }] = await Promise.all([
    send({ type: "getState" }),
    chrome.storage.local.get("cardPosition"),
  ]);

  intervalInput.value    = state.settings.intervalMinutes;
  enabledInput.checked   = !!state.settings.enabled;
  showHiragana.checked   = state.settings.showHiragana !== false;
  showFurigana.checked   = !!state.settings.showFurigana;
  applyActiveTheme(state.settings.theme || "blue");
  applyActivePos(cardPosition);
  applyActiveMode(state.settings.cardMode || "classic");

  deckList.innerHTML = "";
  emptyDecks.style.display = state.decks.length ? "none" : "block";

  for (const deck of state.decks) {
    const count = Object.keys(state.cards[deck.id] || {}).length;
    const li = document.createElement("li");
    li.className = "deck";
    li.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${deck.enabled !== false ? "checked" : ""} />
        <span class="slider"></span>
      </label>
      <div class="meta">
        <div class="name"></div>
        <div class="sub">${count} cards · ${timeAgo(deck.lastSynced)}</div>
      </div>
      <button class="rm">Delete</button>
    `;
    li.querySelector(".name").textContent = deck.name;
    li.querySelector("input").addEventListener("change", async (e) => {
      await send({ type: "toggleDeck", deckId: deck.id, enabled: e.target.checked });
    });
    li.querySelector(".rm").addEventListener("click", async () => {
      if (!confirm(`Delete deck "${deck.name}"? Card progress will be lost.`)) return;
      await send({ type: "removeDeck", deckId: deck.id });
/* -------------------------------- study tab ------------------------------- */

let studyState = { deckId: null, cards: [], index: 0, revealed: false };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function renderStudy() {
  const container = el("studyContent");
  const state     = await send({ type: "getState" });

  if (!state.decks.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No decks yet. Add one in Settings.</p>';
    return;
  }

  studyState.revealed = false;

  // Deck selector
  let html = '<div class="study-toolbar"><label>Deck</label><select id="studyDeckSelect">';
  for (const deck of state.decks) {
    const sel = studyState.deckId === deck.id ? " selected" : "";
    html += `<option value="${deck.id}"${sel}>${deck.name}</option>`;
  }
  html += '</select></div>';

  const selectedId = studyState.deckId || state.decks[0].id;
  studyState.deckId = selectedId;
  const cards = state.cards[selectedId] || {};
  const entries = Object.entries(cards);

  if (!entries.length) {
    container.innerHTML = html + '<p class="empty" style="margin-top:12px">This deck is empty.</p>';
    return;
  }

  if (studyState.cards.length === 0 || studyState.deckId !== selectedId) {
    studyState.cards = entries.map(([key, c]) => ({ key, ...c }));
    studyState.index = 0;
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
    </div>
    <div class="study-browse" id="studyBrowse"></div>
  `;

  container.innerHTML = html;

  // Render browse table
  renderStudyBrowse(container, entries);

  // Card click → reveal
  document.getElementById("studyCard").addEventListener("click", () => {
    if (!studyState.revealed) {
      studyState.revealed = true;
      renderStudy();
    }
  });

  document.getElementById("studyKnow").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "known" });
    studyState.revealed = false;
    if (studyState.index < studyState.cards.length - 1) studyState.index++;
    renderStudy();
  });

  document.getElementById("studyHint").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "hint" });
    studyState.revealed = false;
    if (studyState.index < studyState.cards.length - 1) studyState.index++;
    renderStudy();
  });

  document.getElementById("studyForgot").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "forgot" });
    studyState.revealed = false;
    if (studyState.index < studyState.cards.length - 1) studyState.index++;
    renderStudy();
  });

  document.getElementById("studyPrev").addEventListener("click", () => {
    if (studyState.index > 0) {
      studyState.revealed = false;
      studyState.index--;
      renderStudy();
    }
  });

  document.getElementById("studyNext").addEventListener("click", () => {
    studyState.revealed = false;
    if (studyState.index < studyState.cards.length - 1) studyState.index++;
    renderStudy();
  });

  document.getElementById("studyShuffle").addEventListener("click", () => {
    shuffle(studyState.cards);
    studyState.index = 0;
    studyState.revealed = false;
    renderStudy();
  });

  document.getElementById("studyDeckSelect").addEventListener("change", (e) => {
    studyState.deckId = e.target.value;
    studyState.cards = [];
    studyState.index = 0;
    studyState.revealed = false;
    renderStudy();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", studyKeyHandler);
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

function renderStudyBrowse(container, entries) {
  const wrap = container.querySelector(".study-browse");
  if (!wrap) return;
  let html = '<table class="stats-table"><thead><tr><th>Kanji</th><th>Reading</th><th>Arti</th><th>Notes</th></tr></thead><tbody>';
  for (const [, c] of entries) {
    html += `<tr><td class="kanji-cell">${c.kanji}</td><td class="reading-cell">${c.hiragana || "—"}</td><td>${c.arti || "—"}</td><td class="cell-muted">${c.notes || ""}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

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

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanes.forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
    if (tab === "stats") renderStats();
    if (tab === "study") renderStudy();
  });
});

/* ---------------------------------- stats --------------------------------- */

async function renderStats() {
  const container = el("statsContent");
  const state     = await send({ type: "getState" });

  if (!state.decks.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No decks yet.</p>';
    return;
  }

  container.innerHTML = "";

  for (const deck of state.decks) {
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
      container.appendChild(section);
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
        <th>Kanji</th><th>Reading</th><th>Arti</th><th>Shown</th><th>Last seen</th><th>Know</th><th>Hint</th><th>Forgot</th><th>Ratio</th>
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
    container.appendChild(section);
  }
}

/* -------------------------------- study tab ------------------------------- */

let studyState = { deckId: null, cards: [], index: 0, revealed: false };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function renderStudy() {
  const container = el("studyContent");
  const state     = await send({ type: "getState" });

  if (!state.decks.length) {
    container.innerHTML = '<p class="empty" style="margin-top:12px">No decks yet. Add one in Settings.</p>';
    return;
  }

  studyState.revealed = false;

  let html = '<div class="study-toolbar"><label>Deck</label><select id="studyDeckSelect">';
  for (const deck of state.decks) {
    const sel = studyState.deckId === deck.id ? " selected" : "";
    html += `<option value="${deck.id}"${sel}>${deck.name}</option>`;
  }
  html += '</select></div>';

  const selectedId = studyState.deckId || state.decks[0].id;
  studyState.deckId = selectedId;
  const cards = state.cards[selectedId] || {};
  const entries = Object.entries(cards);

  if (!entries.length) {
    container.innerHTML = html + '<p class="empty" style="margin-top:12px">This deck is empty.</p>';
    return;
  }

  if (studyState.cards.length === 0 || studyState.deckId !== selectedId) {
    studyState.cards = entries.map(([key, c]) => ({ key, ...c }));
    studyState.index = 0;
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
    </div>
    <div class="study-browse" id="studyBrowse"></div>
  `;

  container.innerHTML = html;

  renderStudyBrowse(container, entries);

  document.getElementById("studyCard").addEventListener("click", () => {
    if (!studyState.revealed) {
      studyState.revealed = true;
      renderStudy();
    }
  });

  document.getElementById("studyKnow").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "known" });
    advanceStudy();
  });

  document.getElementById("studyHint").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "hint" });
    advanceStudy();
  });

  document.getElementById("studyForgot").addEventListener("click", async () => {
    await send({ type: "grade", deckId: studyState.deckId, key: current.key, result: "forgot" });
    advanceStudy();
  });

  document.getElementById("studyPrev").addEventListener("click", () => {
    if (studyState.index > 0) {
      studyState.revealed = false;
      studyState.index--;
      renderStudy();
    }
  });

  document.getElementById("studyNext").addEventListener("click", () => {
    advanceStudy();
  });

  document.getElementById("studyShuffle").addEventListener("click", () => {
    shuffle(studyState.cards);
    studyState.index = 0;
    studyState.revealed = false;
    renderStudy();
  });

  document.getElementById("studyDeckSelect").addEventListener("change", (e) => {
    studyState.deckId = e.target.value;
    studyState.cards = [];
    studyState.index = 0;
    studyState.revealed = false;
    renderStudy();
  });

  document.addEventListener("keydown", studyKeyHandler);
}

function advanceStudy() {
  studyState.revealed = false;
  if (studyState.index < studyState.cards.length - 1) {
    studyState.index++;
    renderStudy();
  } else {
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

function renderStudyBrowse(container, entries) {
  const wrap = container.querySelector(".study-browse");
  if (!wrap) return;
  let html = '<table class="stats-table"><thead><tr><th>Kanji</th><th>Reading</th><th>Arti</th><th>Notes</th></tr></thead><tbody>';
  for (const [, c] of entries) {
    html += `<tr><td class="kanji-cell">${c.kanji}</td><td class="reading-cell">${c.hiragana || "—"}</td><td>${c.arti || "—"}</td><td class="cell-muted">${c.notes || ""}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

render();
