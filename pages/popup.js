const send = (msg) => chrome.runtime.sendMessage(msg);

const wordCountEl = document.getElementById("wordCount");
const learningCountEl = document.getElementById("learningCount");
const collectionStatusEl = document.getElementById("collectionStatus");
const countdownEl = document.getElementById("countdown");
const nextLabelEl = document.getElementById("nextLabel");
const cdFillEl = document.getElementById("cdFill");
const controlsEl = document.querySelector(".controls");
const popupToggle = document.getElementById("popupToggle");
const highlightToggle = document.getElementById("highlightToggle");
const quizBtn = document.getElementById("quizBtn");
const addWordShortcut = document.getElementById("addWordShortcut");
const openBankBtn = document.getElementById("openBankBtn");

const quickAdd = document.getElementById("quickAdd");
const qaKanji = document.getElementById("qaKanji");
const qaHiragana = document.getElementById("qaHiragana");
const qaArti = document.getElementById("qaArti");
const qaNotes = document.getElementById("qaNotes");
const qaIncludeSwitchWrap = document.getElementById("qaIncludeSwitchWrap");
const qaIncludeLabelText = document.getElementById("qaIncludeLabelText");
const qaIncludeInStudy = document.getElementById("qaIncludeInStudy");
const qaStatus = document.getElementById("qaStatus");
const qaSaveBtn = document.getElementById("qaSaveBtn");
const qaCancelBtn = document.getElementById("qaCancelBtn");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
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
  // getState (settings/theme) and getStats (the headline numbers below) are
  // independent reads — see background.js's "getStats" handler for why the
  // eligibility count lives there rather than a 3rd copy-pasted rule here.
  const [state, stats] = await Promise.all([
    send({ type: "getState" }),
    send({ type: "getStats" }),
  ]);
  applyTheme(state.settings.theme, state.settings.colorMode);

  wordCountEl.textContent = stats.totalWords;
  learningCountEl.textContent = stats.eligibleWords;
  collectionStatusEl.textContent = stats.collectionCount
    ? `${stats.collectionCount} collection${stats.collectionCount === 1 ? "" : "s"}`
    : "No collections yet.";

  // Visual-only: share of the bank currently in rotation (the bar under
  // the two stat tiles).
  const pct = stats.totalWords ? Math.round((stats.eligibleWords / stats.totalWords) * 100) : 0;
  document.getElementById("rotationMeter").style.width = `${pct}%`;

  await loadSchedule();
}

/* ------------------------- live countdown + toggles ------------------------ */
// Schedule comes from background.js ("getSchedule") — it owns the alarm and
// knows about snooze and a card still waiting on the page. This file only
// ticks the display once a second between fetches.
let schedule = null;
let refetchAt = 0;

async function loadSchedule() {
  schedule = await send({ type: "getSchedule" });
  if (!schedule) return;
  popupToggle.checked = schedule.enabled;
  highlightToggle.checked = schedule.readerHighlight;
  renderCountdown();
}

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function renderCountdown() {
  if (!schedule) return;
  const now = Date.now();
  let state, label, text, progress = 0;
  if (!schedule.enabled) {
    state = "off"; label = "Pop-up cards"; text = "Off";
  } else if (!schedule.nextAt) {
    state = "on"; label = "Next card"; text = "—";
  } else if (schedule.cardShowing) {
    state = "waiting"; label = "A card is waiting"; text = "on your page";
  } else {
    const remaining = schedule.nextAt - now;
    const snoozed = now < schedule.snoozeUntil;
    state = snoozed ? "snoozed" : "on";
    label = snoozed ? "Snoozed · next card in" : "Next card in";
    text = remaining > 0 ? fmt(remaining) : "any second…";
    progress = snoozed ? 0 : 1 - Math.min(1, Math.max(0, remaining / schedule.periodMs));
    // Past the scheduled time: the alarm has fired (or is about to) and
    // rolled forward — ask background for the new time, at most every 2s.
    if (remaining <= 0 && now > refetchAt) { refetchAt = now + 2000; setTimeout(loadSchedule, 1500); }
  }
  controlsEl.dataset.state = state;
  nextLabelEl.textContent = label;
  countdownEl.textContent = text;
  cdFillEl.style.width = `${Math.round(progress * 100)}%`;
}

setInterval(renderCountdown, 1000);

popupToggle.addEventListener("change", async () => {
  await send({ type: "updateSettings", patch: { enabled: popupToggle.checked } });
  loadSchedule();
});

// reader.js on every open tab listens for settings changes, so this applies
// to pages that are already open — no reload needed.
highlightToggle.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { readerHighlight: highlightToggle.checked } })
);

quizBtn.addEventListener("click", async () => {
  await send({ type: "showNow" });
  window.close(); // get out of the way so the card on the page is visible
});

// Study, Words, Kanji, Stats, Graph, and Settings are all tabs inside
// options.html itself — one button here is enough, the tab bar takes over
// from there. Syncing also moved fully into Settings' own "Sync all"
// button, so there's no sync action left in the popup to duplicate it.
openBankBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("pages/options.html") }));

// Quick-add: capture a word straight from the popup, no navigating away.
// Mirrors word-editor.js's Add-mode logic (same collision/merge rule), and
// uses the shared collection picker (core/collection-picker.js): search,
// create-from-search, clear selected state. The collections used on the
// last save are pre-selected next time, since you often add several words
// to the same one in a row.
const LAST_COLLECTIONS_KEY = "lastCollectionIds";

async function createCollection(name) {
  const group = { id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, type: "manual", sourceSheetUrl: null };
  await putGroup(group);
  return group;
}

const qaPicker = createCollectionPicker(document.getElementById("qaCollections"), {
  onCreate: createCollection,
  onRename: (groupId, name) => send({ type: "renameGroup", groupId, name }),
});

function qaSelectedGroupIds() {
  return qaPicker.getSelected();
}

async function openQuickAdd() {
  qaPicker.setGroups(await getAllGroups());
  qaPicker.setSelected((await chrome.storage.local.get(LAST_COLLECTIONS_KEY))[LAST_COLLECTIONS_KEY] || []);
  qaPicker.reset();
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

// Chrome closes the whole extension popup on Escape by default — normally
// convenient, but while quick-add is open that silently throws away
// whatever you'd just typed (there's no draft autosave). Capturing keydown
// ahead of Chrome's own handler and stopping it there suppresses that
// close; while the form is open Escape is a full no-op instead, so an
// accidental press can't lose the word you're mid-typing. Getting out
// still works the normal way — Cancel, or Save. Capture phase (the `true`
// 3rd arg) is what lets this run before Chrome's default handling sees the
// key at all, not just before other page listeners.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!quickAdd.classList.contains("open")) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

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

  await chrome.storage.local.set({ [LAST_COLLECTIONS_KEY]: groupIds });
  qaStatus.textContent = "Saved!";
  setTimeout(closeQuickAdd, 700);
});

refresh();
