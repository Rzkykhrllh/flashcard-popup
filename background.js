/*
 * background.js — the brain of the extension (Manifest V3 service worker).
 *
 * Responsibilities:
 *   1. Sync: fetch each deck's Google Sheet tab as CSV, parse, MERGE into storage
 *      (update text, keep per-card progress, add new cards, never delete).
 *   2. Schedule: a single chrome.alarms tick that fires a flashcard on the active tab.
 *   3. Record grades (known/forgot) and snooze requests coming back from the overlay.
 *
 * Note: the service worker can be shut down by Chrome at any time, so we never
 * keep important state in memory — everything lives in chrome.storage.local.
 */

importScripts("lib/papaparse.min.js"); // exposes global `Papa`

const ALARM_NAME = "nihongo-tick";

const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMinutes: 15,
  snoozeUntil: 0,
  showHiragana: true,
  theme: "blue",
};

// in-memory only; used to avoid showing the same card twice in a row.
let lastShownKey = null;

// Track the currently showing card so we can re-show it on other tabs.
let currentCard = null;

/* ----------------------------- storage helpers ---------------------------- */

async function getState() {
  const { settings, decks, cards } = await chrome.storage.local.get([
    "settings",
    "decks",
    "cards",
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    decks: decks || [],
    cards: cards || {}, // { [deckId]: { [cardKey]: card } }
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

function buildCsvUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
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

// MERGE: update text on existing cards (keep progress), add new ones, keep the rest.
async function syncDeck(deck) {
  const url = buildCsvUrl(deck.spreadsheetId, deck.gid);
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
  const state = await getState();
  const existing = state.cards[deck.id] || {};
  const now = Date.now();
  let added = 0;
  let updated = 0;

  for (const r of rows) {
    const key = cardKey(r.kanji, r.hiragana);
    if (existing[key]) {
      // keep progress, refresh the text fields
      existing[key].kanji = r.kanji;
      existing[key].hiragana = r.hiragana;
      existing[key].arti = r.arti;
      existing[key].notes = r.notes;
      updated++;
    } else {
      existing[key] = {
        kanji: r.kanji,
        hiragana: r.hiragana,
        arti: r.arti,
        notes: r.notes,
        seen: 0,
        known: 0,
        forgot: 0,
        lastSeen: 0,
        createdAt: now,
      };
      added++;
    }
  }

  state.cards[deck.id] = existing;
  const cardCount = Object.keys(existing).length;
  const decks = state.decks.map((d) =>
    d.id === deck.id ? { ...d, lastSynced: now, cardCount } : d
  );
  await chrome.storage.local.set({ cards: state.cards, decks });
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

/* ------------------------------ card picking ------------------------------ */

// Weighted pick: new and "forgotten" cards surface more often. Light, not FSRS.
function pickCard(state) {
  const pool = [];
  for (const deck of state.decks) {
    if (deck.enabled === false) continue;
    const cards = state.cards[deck.id] || {};
    for (const [key, c] of Object.entries(cards)) {
      let w = 1;
      if (c.seen === 0) w += 3; // brand new — prioritise
      const net = (c.known || 0) - (c.forgot || 0);
      w += Math.max(0, 3 - net); // weaker recall -> heavier
      if ((c.forgot || 0) > (c.known || 0)) w += 2;
      pool.push({ deckId: deck.id, key, card: c, weight: w });
    }
  }
  if (pool.length === 0) return null;

  // avoid an immediate repeat when we have options
  let candidates = pool;
  if (pool.length > 1 && lastShownKey) {
    const filtered = pool.filter((p) => `${p.deckId}:${p.key}` !== lastShownKey);
    if (filtered.length) candidates = filtered;
  }

  const total = candidates.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  for (const p of candidates) {
    roll -= p.weight;
    if (roll <= 0) {
      lastShownKey = `${p.deckId}:${p.key}`;
      return p;
    }
  }
  const last = candidates[candidates.length - 1];
  lastShownKey = `${last.deckId}:${last.key}`;
  return last;
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

  const picked = pickCard(state);
  if (!picked) return;

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

async function recordGrade(deckId, key, result) {
  const state = await getState();
  const card = state.cards[deckId] && state.cards[deckId][key];
  if (!card) return;
  card.seen = (card.seen || 0) + 1;
  card.lastSeen = Date.now();
  if (result === "known") card.known = (card.known || 0) + 1;
  else if (result === "forgot") card.forgot = (card.forgot || 0) + 1;
  await chrome.storage.local.set({ cards: state.cards });
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
});

chrome.runtime.onStartup.addListener(() => {
  rescheduleAlarm();
});

/* -------------------------------- messaging ------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "getState": {
        sendResponse(await getState());
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
        const state = await getState();
        const decks = state.decks.filter((d) => d.id !== msg.deckId);
        delete state.cards[msg.deckId];
        await chrome.storage.local.set({ decks, cards: state.cards });
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
        await recordGrade(msg.deckId, msg.key, msg.result);
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
        sendResponse({ ok: true, settings: next });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
