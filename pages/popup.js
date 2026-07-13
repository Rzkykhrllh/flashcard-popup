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
const qaGroupSelect = document.getElementById("qaGroupSelect");
const qaNewGroupName = document.getElementById("qaNewGroupName");
const qaStatus = document.getElementById("qaStatus");
const qaSaveBtn = document.getElementById("qaSaveBtn");
const qaCancelBtn = document.getElementById("qaCancelBtn");

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
// Mirrors word-editor.js's Add-mode logic (same collision/merge rule), kept
// as its own copy since popup.js and word-editor.js never share a page.
async function openQuickAdd() {
  const groups = await getAllGroups();
  qaGroupSelect.innerHTML = [
    ...groups.map((g) => `<option value="${g.id}">${g.name}</option>`),
    `<option value="__new__">+ New collection…</option>`,
  ].join("");
  qaNewGroupName.style.display = "none";
  qaNewGroupName.value = "";
  qaKanji.value = ""; qaHiragana.value = ""; qaArti.value = ""; qaNotes.value = "";
  qaStatus.textContent = "";
  quickAdd.classList.add("open");
  qaKanji.focus();
}

function closeQuickAdd() {
  quickAdd.classList.remove("open");
}

addWordShortcut.addEventListener("click", openQuickAdd);
qaCancelBtn.addEventListener("click", closeQuickAdd);

qaGroupSelect.addEventListener("change", () => {
  qaNewGroupName.style.display = qaGroupSelect.value === "__new__" ? "" : "none";
});

qaSaveBtn.addEventListener("click", async () => {
  const kanji = qaKanji.value.trim();
  const hiragana = qaHiragana.value.trim();
  const arti = qaArti.value.trim();
  const notes = qaNotes.value.trim();
  if (!kanji) { qaStatus.textContent = "Kanji can't be empty."; return; }

  let groupId = qaGroupSelect.value;
  if (groupId === "__new__") {
    const name = qaNewGroupName.value.trim();
    if (!name) { qaStatus.textContent = "Collection name can't be empty."; return; }
    groupId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await putGroup({ id: groupId, name, type: "manual", sourceSheetUrl: null });
  }
  if (!groupId) { qaStatus.textContent = "Pick a collection."; return; }

  const id = `${kanji}|${hiragana}`;
  const existing = await getWord(id);
  if (existing) {
    const ok = confirm(`"${kanji}${hiragana ? " / " + hiragana : ""}" already exists. Update it and add to this collection?`);
    if (!ok) return;
    existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti; existing.notes = notes;
    existing.kanjiList = extractKanjiList(kanji);
    existing.groupIds = [...new Set([...(existing.groupIds || []), groupId])];
    await putWord(existing);
  } else {
    await putWord({
      id, kanji, hiragana, arti, notes,
      kanjiList: extractKanjiList(kanji),
      seen: 0, known: 0, hint: 0, forgot: 0, lastSeen: 0, createdAt: Date.now(),
      n: 0, easeFactor: 2.5, status: "new", statusOverride: false,
      source: "manual", groupIds: [groupId],
    });
  }

  qaStatus.textContent = "Saved!";
  setTimeout(closeQuickAdd, 700);
});

refresh();
