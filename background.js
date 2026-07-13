/*
 * background.js — the brain of the extension (Manifest V3 service worker).
 *
 * Responsibilities:
 *   1. Sync: fetch each deck's Google Sheet tab as CSV, parse, MERGE into the
 *      IndexedDB `words` store (update text, keep per-card progress, add new
 *      cards, never delete — see core/db.js).
 *   2. Schedule: a single chrome.alarms tick that fires a flashcard on the active tab.
 *   3. Record grades (known/forgot) via SM-2 state in srs.js to weight future picks.
 *
 * Card SRS fields (per word in IndexedDB):
 *   n          — consecutive successful reviews (resets to 0 on forgot)
 *   easeFactor — SM-2 EF, starts at 2.5, minimum 1.3
 *
 * Storage split: `settings`, `decks` (sync config — url/spreadsheetId/enabled/
 * lastSynced), and `selection` still live in chrome.storage.local. Actual word
 * data lives in IndexedDB `words`, keyed by `kanji|hiragana` and linked back to
 * decks via `groupIds` (a word can belong to more than one deck). getState()
 * reshapes IndexedDB into the same { [deckId]: { [cardKey]: card } } view the
 * rest of the extension (popup.js, options.js, srs.js) already expects, so
 * only this file needed to change.
 *
 * Note: the service worker can be shut down by Chrome at any time, so we never
 * keep important state in memory beyond a single message handler's lifetime.
 */

importScripts("lib/papaparse.min.js"); // exposes global `Papa`
importScripts("core/srs.js");         // pickCard, applySM2, deriveStatus
importScripts("core/kanji.js");       // extractKanjiList
importScripts("core/db.js");          // IndexedDB words/groups layer
importScripts("core/migrate.js");     // one-time chrome.storage.local -> IndexedDB migration

const ALARM_NAME = "nihongo-tick";

const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMinutes: 15,
  snoozeUntil: 0,
  showHiragana: true,
  showFurigana: false,
  theme: "blue",
  colorMode: "system", // "system" | "light" | "dark" — manual override of prefers-color-scheme
  cardMode: "classic",
};

// in-memory only; used to avoid showing the same card twice in a row.
let lastShownKey = null;

// Track the currently showing card so we can re-show it on other tabs.
let currentCard = null;

/* ----------------------------- storage helpers ---------------------------- */

// Word (IndexedDB) -> legacy per-deck card shape that srs.js/popup.js/options.js expect.
function wordToCard(w) {
  return {
    kanji: w.kanji,
    hiragana: w.hiragana,
    arti: w.arti,
    notes: w.notes,
    seen: w.seen || 0,
    known: w.known || 0,
    hint: w.hint || 0,
    forgot: w.forgot || 0,
    lastSeen: w.lastSeen || 0,
    createdAt: w.createdAt || 0,
    n: w.n || 0,
    easeFactor: w.easeFactor || 2.5,
  };
}

async function getState() {
  const { settings, decks, selection } = await chrome.storage.local.get([
    "settings",
    "decks",
    "selection",
  ]);
  const deckList = decks || [];

  // `decks` (chrome.storage.local) only tracks Google-Sheet sync config
  // (url/enabled/lastSynced) and is what Settings' "Your decks" panel and
  // add/remove/toggleDeck manage — that stays deck-only, unchanged. But a
  // word can also belong to a manual collection (a plain IndexedDB group,
  // created via "New collection" when adding a word by hand) that never
  // gets a `decks` entry. "categories" is the superset both kinds of
  // grouping resolve into — every IndexedDB group, sync or manual — so
  // Study/Stats/the flashcard popup can pull words from either. A synced
  // group keeps its deck's enabled/url/etc.; a manual group just gets a
  // default `enabled: true` (there's no pause switch for those yet).
  const deckById = new Map(deckList.map((d) => [d.id, d]));
  const categories = (await getAllGroups()).map(
    (g) => deckById.get(g.id) || { id: g.id, name: g.name, enabled: true }
  );

  const cards = {}; // { [categoryId]: { [cardKey]: card } } — derived from IndexedDB `words`
  for (const cat of categories) cards[cat.id] = {};
  for (const w of await getAllWords()) {
    for (const groupId of w.groupIds || []) {
      if (cards[groupId]) cards[groupId][w.id] = wordToCard(w);
    }
  }

  return {
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    decks: deckList,
    categories,
    cards,
    selection: selection || {}, // { [categoryId]: { [cardKey]: true } }
  };
}

async function saveSettings(patch) {
  const { settings } = await getState();
  const next = { ...settings, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ------------------------------ google sheet ------------------------------ */

// Pull spreadsheet id + tab gid out of a normal sheet URL the user pastes.
function parseSheetUrl(url) {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  if (!idMatch) return null;
  return { spreadsheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
}

function buildCsvUrl(spreadsheetId, gid, sheetName) {
  if (sheetName) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid || "0"}`;
}

// Stable key for a card so merge can match rows across syncs.
function cardKey(kanji, hiragana) {
  return `${(kanji || "").trim()}|${(hiragana || "").trim()}`;
}

// Find a column value by matching header names (flexible), with a positional fallback.
function pickField(row, fields, regex, fallbackIndex) {
  for (const name of fields) {
    if (regex.test(name.toLowerCase())) {
      const v = row[name];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  const fb = fields[fallbackIndex];
  if (fb && row[fb] != null) return String(row[fb]).trim();
  return "";
}

function rowsToCards(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const fields = (parsed.meta && parsed.meta.fields) || [];
  const out = [];
  for (const row of parsed.data) {
    const kanji = pickField(row, fields, /kanji|kata|word|語|単語/, 0);
    if (!kanji) continue; // a card needs at least a front
    const hiragana = pickField(row, fields, /hiragana|kana|reading|yomi|furigana|読み/, 1);
    const arti = pickField(row, fields, /arti|mean|definisi|definition|translation|english|意味/, 2);
    const notes = pickField(row, fields, /note|catatan|memo|keterangan|備考/, 3);
    out.push({ kanji, hiragana, arti, notes });
  }
  return out;
}

// Fetch all sheet tab names from the spreadsheet HTML.
// Works for sheets that are "anyone with link can view".
// Returns [{ name }] — no gids needed; CSV is fetched by name via gviz.
async function fetchSheetTabs(spreadsheetId) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  let html;
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      { redirect: "follow", signal: controller.signal }
    );
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.url.includes("docs.google.com/spreadsheets")) {
      throw new Error('Sheet is not publicly accessible. Set to "anyone with the link can view".');
    }
    html = await res.text();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }

  const names = [];

  // The currently active tab appears in the title breadcrumb area.
  const activeM = html.match(/class="[^"]*docs-title-spark-text[^"]*">([^<]+)</);
  if (activeM) names.push(activeM[1].trim());

  // All other (non-active) tabs appear in the bottom tab bar.
  const tabRe = /docs-sheet-tab-caption">([^<]+)</g;
  let m;
  while ((m = tabRe.exec(html)) !== null) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length ? names.map(name => ({ name })) : null;
}

// MERGE: update text on existing words (keep progress), add new ones, keep the
// rest. A word already tracked by another deck just gets this deck added to
// its groupIds — words are shared by kanji|hiragana identity, not duplicated
// per deck (next_feature.md §1/§7.1).
async function syncDeck(deck) {
  const url = buildCsvUrl(deck.spreadsheetId, deck.gid, deck.sheetName);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — make sure the sheet is set to "anyone with the link can view".`);
  }
  const text = await res.text();
  // Google returns an HTML login page (not CSV) when a sheet isn't link-viewable.
  if (text.trimStart().toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
    throw new Error('Sheet is not publicly accessible. Set to "anyone with the link can view".');
  }

  const rows = rowsToCards(text);
  const now = Date.now();
  let added = 0;
  let updated = 0;

  for (const r of rows) {
    const key = cardKey(r.kanji, r.hiragana);
    const existing = await getWord(key);
    if (existing) {
      // keep progress, refresh the text fields
      existing.kanji = r.kanji;
      existing.hiragana = r.hiragana;
      existing.arti = r.arti;
      existing.notes = r.notes;
      existing.kanjiList = extractKanjiList(r.kanji);
      existing.groupIds = [...new Set([...(existing.groupIds || []), deck.id])];
      await putWord(existing);
      updated++;
    } else {
      await putWord({
        id: key,
        kanji: r.kanji,
        hiragana: r.hiragana,
        arti: r.arti,
        notes: r.notes,
        kanjiList: extractKanjiList(r.kanji),
        seen: 0,
        known: 0,
        hint: 0,
        forgot: 0,
        lastSeen: 0,
        createdAt: now,
        n: 0,
        easeFactor: 2.5,
        status: "new",
        statusOverride: false,
        source: "sheet",
        groupIds: [deck.id],
      });
      added++;
    }
  }

  const cardCount = (await getWordsByGroup(deck.id)).length;
  await putGroup({ id: deck.id, name: deck.name, type: "synced", sourceSheetUrl: deck.url || null });

  const { decks: decksNow } = await chrome.storage.local.get("decks");
  const decks = (decksNow || []).map((d) =>
    d.id === deck.id ? { ...d, lastSynced: now, cardCount } : d
  );
  await chrome.storage.local.set({ decks });
  return { added, updated, cardCount };
}

async function syncAllDecks() {
  const { decks } = await getState();
  const results = [];
  for (const deck of decks) {
    try {
      const r = await syncDeck(deck);
      results.push({ deckId: deck.id, name: deck.name, ok: true, ...r });
    } catch (e) {
      results.push({ deckId: deck.id, name: deck.name, ok: false, error: e.message });
    }
  }
  return results;
}

// Send a message to a tab, injecting the content script first if it's not yet loaded.
// Returns true if the message was delivered successfully.
async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (_) {
    // Content script not loaded (tab was open before extension installed, or just navigated).
    // Try injecting it dynamically, then retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (_) {
      // Tab is restricted (chrome://, web store, PDF, etc.) — nothing we can do.
      return false;
    }
  }
}

async function showCardOnActiveTab() {
  const state = await getState();
  if (!state.settings.enabled) return;
  if (Date.now() < (state.settings.snoozeUntil || 0)) return;

  // Don't stack — wait until the current card is graded
  if (currentCard) return;

  const picked = pickCard(state, lastShownKey);
  if (!picked) return;
  lastShownKey = `${picked.deckId}:${picked.key}`;

  currentCard = {
    type: "showCard",
    card: {
      deckId: picked.deckId,
      key: picked.key,
      kanji: picked.card.kanji,
      hiragana: picked.card.hiragana,
      arti: picked.card.arti,
      notes: picked.card.notes,
    },
  };

  // Find the active tab in the last focused normal browser window.
  // Using currentWindow:true or active:true alone misfires when the extension popup is
  // open — it becomes the focused window but has no tabs, so we'd get the wrong window
  // or an empty result. getLastFocused({windowTypes:['normal']}) skips popup windows.
  let tabs = [];
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    tabs = await chrome.tabs.query({ active: true, windowId: win.id });
  } catch (_) {
    tabs = await chrome.tabs.query({ active: true });
  }

  for (const tab of tabs) {
    if (!tab?.id) continue;
    if (await sendToTab(tab.id, currentCard)) return; // delivered successfully
  }
  // No tab could receive the card; reset so the next alarm tick can try fresh.
  currentCard = null;
}

async function closeCardOnAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab?.id) sendToTab(tab.id, { type: "closeCard" });
  }
}

/* ------------------------------ grade + snooze ---------------------------- */

async function recordGrade(key, result) {
  const card = await getWord(key);
  if (!card) return;
  card.seen = (card.seen || 0) + 1;
  card.lastSeen = Date.now();
  if (result === "known") card.known = (card.known || 0) + 1;
  else if (result === "hint")   card.hint  = (card.hint  || 0) + 1;
  else if (result === "forgot") card.forgot = (card.forgot || 0) + 1;
  Object.assign(card, applySM2(card, result));
  if (!card.statusOverride) card.status = deriveStatus(card);
  await putWord(card);
}

/* --------------------------------- theming --------------------------------- */

// Toolbar icon per "Color theme" setting — icons/{theme}/icon*.png, generated
// from the base blue set (icons/icon*.png doubles as the "blue" variant).
async function applyThemeIcon(theme) {
  const dir = theme && theme !== "blue" ? `icons/${theme}` : "icons";
  try {
    await chrome.action.setIcon({
      path: { 16: `${dir}/icon16.png`, 48: `${dir}/icon48.png`, 128: `${dir}/icon128.png` },
    });
  } catch (e) {
    console.error("[theme] setIcon failed", e);
  }
}

/* ------------------------------- scheduling ------------------------------- */

async function rescheduleAlarm() {
  const { settings } = await getState();
  await chrome.alarms.clear(ALARM_NAME);
  const period = Math.max(1, Number(settings.intervalMinutes) || 15);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: period, delayInMinutes: period });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) showCardOnActiveTab();
});

// Follow the user across tabs: show the pending card when they switch to another tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!currentCard) return;
  await sendToTab(activeInfo.tabId, currentCard);
});

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  await rescheduleAlarm();
  await applyThemeIcon((settings || DEFAULT_SETTINGS).theme);
  try {
    await runMigration();
    // One more catch-up before words/groups become the live source of truth,
    // in case review progress kept landing in storage.local between the
    // initial migration and this update — see runLiveCutover in migrate.js.
    await runLiveCutover();
  } catch (e) {
    console.error("[migrate] failed", e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  rescheduleAlarm();
  const { settings } = await chrome.storage.local.get("settings");
  await applyThemeIcon((settings || DEFAULT_SETTINGS).theme);
});

/* -------------------------------- messaging ------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "getState": {
        sendResponse(await getState());
        break;
      }
      case "getSheetTabs": {
        const parsed = parseSheetUrl(msg.url || "");
        if (!parsed) { sendResponse({ ok: false, error: "Invalid sheet URL." }); break; }
        try {
          const tabs = await fetchSheetTabs(parsed.spreadsheetId);
          sendResponse({ ok: true, tabs });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }
      case "addDeck": {
        const parsed = parseSheetUrl(msg.url || "");
        if (!parsed) {
          sendResponse({ ok: false, error: "Invalid sheet URL." });
          break;
        }
        const state = await getState();
        const deck = {
          id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: (msg.name || "Deck").trim() || "Deck",
          url: msg.url,
          spreadsheetId: parsed.spreadsheetId,
          gid: parsed.gid,
          sheetName: msg.sheetName || null,
          enabled: true,
          lastSynced: 0,
          cardCount: 0,
        };
        await chrome.storage.local.set({ decks: [...state.decks, deck] });
        // sync immediately so it's usable right away
        try {
          const r = await syncDeck(deck);
          sendResponse({ ok: true, deck, ...r });
        } catch (e) {
          sendResponse({ ok: true, deck, syncError: e.message });
        }
        break;
      }
      case "removeDeck": {
        // Unlink, don't delete: a word can belong to more than one deck, and
        // the whole point of the word bank is that vocab outlives any one
        // deck. Only the deck's own group record goes away.
        const state = await getState();
        const decks = state.decks.filter((d) => d.id !== msg.deckId);
        for (const w of await getWordsByGroup(msg.deckId)) {
          w.groupIds = (w.groupIds || []).filter((g) => g !== msg.deckId);
          await putWord(w);
        }
        await deleteGroup(msg.deckId);
        await chrome.storage.local.set({ decks });
        sendResponse({ ok: true });
        break;
      }
      case "toggleDeck": {
        const state = await getState();
        const decks = state.decks.map((d) =>
          d.id === msg.deckId ? { ...d, enabled: !!msg.enabled } : d
        );
        await chrome.storage.local.set({ decks });
        sendResponse({ ok: true });
        break;
      }
      case "syncAll": {
        sendResponse({ ok: true, results: await syncAllDecks() });
        break;
      }
      case "showNow": {
        currentCard = null; // allow forcing a new card even if one is pending
        await showCardOnActiveTab();
        sendResponse({ ok: true });
        break;
      }
      case "grade": {
        await recordGrade(msg.key, msg.result);
        currentCard = null;
        closeCardOnAllTabs();
        sendResponse({ ok: true });
        break;
      }
      case "snooze": {
        const until = Date.now() + (Number(msg.minutes) || 30) * 60000;
        await saveSettings({ snoozeUntil: until });
        currentCard = null;
        closeCardOnAllTabs();
        sendResponse({ ok: true, snoozeUntil: until });
        break;
      }
      case "updateSettings": {
        const next = await saveSettings(msg.patch || {});
        if (msg.patch && "intervalMinutes" in msg.patch) await rescheduleAlarm();
        if (msg.patch && "theme" in msg.patch) await applyThemeIcon(next.theme);
        sendResponse({ ok: true, settings: next });
        break;
      }
      case "getSelection": {
        const { selection } = await chrome.storage.local.get("selection");
        sendResponse({ selection: selection || {} });
        break;
      }
      case "setCardSelection": {
        const { selection } = await chrome.storage.local.get("selection");
        const sel = selection || {};
        if (!sel[msg.deckId]) sel[msg.deckId] = {};
        if (msg.selected) sel[msg.deckId][msg.key] = true;
        else delete sel[msg.deckId][msg.key];
        await chrome.storage.local.set({ selection: sel });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
