const send = (msg) => chrome.runtime.sendMessage(msg);

const cardCountEl = document.getElementById("cardCount");
const deckCountEl = document.getElementById("deckCount");
const syncStatusEl = document.getElementById("syncStatus");
const enabledStateEl = document.getElementById("enabledState");
const quizBtn = document.getElementById("quizBtn");
const menuToggle = document.getElementById("menuToggle");
const submenu = document.getElementById("submenu");
const studyBtn = document.getElementById("studyBtn");
const bankBtn = document.getElementById("bankBtn");
const addWordShortcut = document.getElementById("addWordShortcut");
const syncBtn = document.getElementById("syncBtn");
const optionsBtn = document.getElementById("optionsBtn");

const quickAdd = document.getElementById("quickAdd");
const qaKanji = document.getElementById("qaKanji");
const qaHiragana = document.getElementById("qaHiragana");
const qaArti = document.getElementById("qaArti");
const qaNotes = document.getElementById("qaNotes");
const qaGroupChecklist = document.getElementById("qaGroupChecklist");
const qaNewGroupName = document.getElementById("qaNewGroupName");
const qaAddGroupBtn = document.getElementById("qaAddGroupBtn");
const qaIncludeInStudy = document.getElementById("qaIncludeInStudy");
const qaStatus = document.getElementById("qaStatus");
const qaSaveBtn = document.getElementById("qaSaveBtn");
const qaCancelBtn = document.getElementById("qaCancelBtn");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function timeAgo(ts) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

// colorMode: "system" | "light" | "dark" (settings.colorMode). Sets an
// explicit data-theme on <html> — popup.css has no @media(prefers-color-
// scheme) fallback (see its top comment), so this must always run, even
// for "system".
let currentColorMode = "system";

function isDarkActive() {
  if (currentColorMode === "dark") return true;
  if (currentColorMode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme, colorMode) {
  currentColorMode = colorMode || "system";
  document.body.classList.remove("theme-blue", "theme-red", "theme-purple", "theme-green");
  document.body.classList.add(`theme-${theme || "blue"}`);
  document.documentElement.setAttribute("data-theme", isDarkActive() ? "dark" : "light");
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentColorMode === "system") document.documentElement.setAttribute("data-theme", isDarkActive() ? "dark" : "light");
});

async function refresh() {
  const state = await send({ type: "getState" });
  applyTheme(state.settings.theme, state.settings.colorMode);
  const enabledDecks = state.decks.filter((d) => d.enabled !== false);
  const total = enabledDecks.reduce(
    (s, d) => s + Object.keys(state.cards[d.id] || {}).length,
    0
  );
  cardCountEl.textContent = total;
  deckCountEl.textContent = enabledDecks.length;

  const lastSynced = Math.max(0, ...state.decks.map((d) => d.lastSynced || 0));
  syncStatusEl.textContent = state.decks.length
    ? `Last sync: ${timeAgo(lastSynced)}.`
    : "No decks — add one in settings.";

  if (!state.settings.enabled) {
    enabledStateEl.textContent = "Popup is disabled.";
  } else if (Date.now() < (state.settings.snoozeUntil || 0)) {
    enabledStateEl.textContent = "Snoozed.";
  } else {
    enabledStateEl.textContent = `Shows every ~${state.settings.intervalMinutes} min.`;
  }
}

quizBtn.addEventListener("click", async () => {
  await send({ type: "showNow" });
  window.close(); // get out of the way so the card on the page is visible
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  const { results } = await send({ type: "syncAll" });
  const failed = (results || []).filter((r) => !r.ok);
  const added = (results || []).reduce((s, r) => s + (r.added || 0), 0);
  syncBtn.disabled = false;
  syncBtn.textContent = "Sync from Google Sheet";
  if (!results || !results.length) {
    enabledStateEl.textContent = "No decks to sync.";
  } else if (failed.length) {
    enabledStateEl.textContent = `${failed.length} deck(s) failed — check settings.`;
  } else {
    enabledStateEl.textContent = added ? `+${added} new cards.` : "Up to date.";
  }
  refresh();
});

menuToggle.addEventListener("click", () => {
  menuToggle.classList.toggle("open");
  submenu.classList.toggle("open");
});

studyBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("pages/options.html#study") }));
bankBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("pages/options.html#list") }));
optionsBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("pages/options.html#settings") }));

// Quick-add: capture a word straight from the popup, no navigating away.
// Mirrors word-editor.js's Add-mode logic (same collision/merge rule, same
// multi-collection checklist), kept as its own copy since popup.js and
// word-editor.js never share a page.
let qaGroups = [];
let qaEditingGroupId = null;

function renderQaGroupChecklist(selectedIds) {
  qaGroupChecklist.innerHTML = qaGroups.length
    ? qaGroups.map((g) => {
        const checked = selectedIds.includes(g.id) ? "checked" : "";
        const nameCell = g.id === qaEditingGroupId
          ? `<input type="text" class="group-rename-input" value="${escapeHtml(g.name)}" />
             <button type="button" class="group-rename-save" title="Save">&#10003;</button>
             <button type="button" class="group-rename-cancel" title="Cancel">&#10005;</button>`
          : `<label for="qagc-${escapeHtml(g.id)}" class="group-check-label">${escapeHtml(g.name)}</label>
             <button type="button" class="group-rename-btn" title="Rename">&#9998;</button>`;
        return `
          <div class="group-check-row" data-id="${escapeHtml(g.id)}">
            <input type="checkbox" class="group-check" id="qagc-${escapeHtml(g.id)}" value="${escapeHtml(g.id)}" ${checked} />
            ${nameCell}
          </div>`;
      }).join("")
    : '<p class="empty" style="margin:2px 0">No collections yet — add one below.</p>';

  qaGroupChecklist.querySelectorAll(".group-rename-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      qaEditingGroupId = btn.closest(".group-check-row").dataset.id;
      renderQaGroupChecklist(qaSelectedGroupIds());
    });
  });
  qaGroupChecklist.querySelectorAll(".group-rename-cancel").forEach((btn) => {
    btn.addEventListener("click", () => {
      qaEditingGroupId = null;
      renderQaGroupChecklist(qaSelectedGroupIds());
    });
  });
  qaGroupChecklist.querySelectorAll(".group-rename-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".group-check-row");
      const id = row.dataset.id;
      const name = row.querySelector(".group-rename-input").value.trim();
      if (!name) return;
      await send({ type: "renameGroup", groupId: id, name });
      const g = qaGroups.find((x) => x.id === id);
      if (g) g.name = name;
      qaEditingGroupId = null;
      renderQaGroupChecklist(qaSelectedGroupIds());
    });
  });
}

function qaSelectedGroupIds() {
  return [...qaGroupChecklist.querySelectorAll(".group-check:checked")].map((cb) => cb.value);
}

async function openQuickAdd() {
  qaGroups = await getAllGroups();
  qaEditingGroupId = null;
  renderQaGroupChecklist([]);
  qaNewGroupName.value = "";
  qaKanji.value = ""; qaHiragana.value = ""; qaArti.value = ""; qaNotes.value = "";
  qaIncludeInStudy.checked = true;
  qaStatus.textContent = "";
  quickAdd.classList.add("open");
  qaKanji.focus();
}

function closeQuickAdd() {
  quickAdd.classList.remove("open");
}

addWordShortcut.addEventListener("click", openQuickAdd);
qaCancelBtn.addEventListener("click", closeQuickAdd);

qaAddGroupBtn.addEventListener("click", async () => {
  const name = qaNewGroupName.value.trim();
  if (!name) return;
  const groupId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const group = { id: groupId, name, type: "manual", sourceSheetUrl: null };
  await putGroup(group);
  qaGroups.push(group);
  qaNewGroupName.value = "";
  renderQaGroupChecklist([...qaSelectedGroupIds(), groupId]);
});

qaSaveBtn.addEventListener("click", async () => {
  const kanji = qaKanji.value.trim();
  const hiragana = qaHiragana.value.trim();
  const arti = qaArti.value.trim();
  const notes = qaNotes.value.trim();
  if (!kanji) { qaStatus.textContent = "Kanji can't be empty."; return; }

  const groupIds = qaSelectedGroupIds();
  if (!groupIds.length) { qaStatus.textContent = "Pick at least one collection."; return; }

  const id = `${kanji}|${hiragana}`;
  const existing = await getWord(id);
  if (existing) {
    const ok = confirm(`"${kanji}${hiragana ? " / " + hiragana : ""}" already exists. Update it and add to these collections?`);
    if (!ok) return;
    existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti; existing.notes = notes;
    existing.kanjiList = extractKanjiList(kanji);
    existing.groupIds = [...new Set([...(existing.groupIds || []), ...groupIds])];
    await putWord(existing);
  } else {
    await putWord({
      id, kanji, hiragana, arti, notes,
      kanjiList: extractKanjiList(kanji),
      seen: 0, known: 0, hint: 0, forgot: 0, lastSeen: 0, createdAt: Date.now(),
      n: 0, easeFactor: 2.5, status: "new", statusOverride: false,
      source: "manual", groupIds,
    });
  }
  for (const groupId of groupIds) {
    await send({ type: "setCardSelection", deckId: groupId, key: id, selected: qaIncludeInStudy.checked });
  }

  qaStatus.textContent = "Saved!";
  setTimeout(closeQuickAdd, 700);
});

refresh();
