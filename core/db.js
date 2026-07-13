// db.js — IndexedDB layer for `words` and `groups` (next_feature.md §3).
// Shared by background.js (service worker, via importScripts) and vocab-bank.js
// (page, via <script>). Plain global functions — no modules, matches how the
// rest of the extension is loaded.

const DB_NAME = "kotobaPopupDB";
const DB_VERSION = 2;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("words")) {
        const words = db.createObjectStore("words", { keyPath: "id" });
        words.createIndex("kanjiList", "kanjiList", { multiEntry: true });
        words.createIndex("groupIds", "groupIds", { multiEntry: true });
        words.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("groups")) {
        db.createObjectStore("groups", { keyPath: "id" });
      }
      // v2: per-kanji user data (manual meaning) — separate from the
      // auto-fetched on'yomi/kun'yomi in data/kanjidic.json, which isn't
      // stored in IndexedDB at all.
      if (!db.objectStoreNames.contains("kanjiMeta")) {
        db.createObjectStore("kanjiMeta", { keyPath: "char" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/* ---------------------------------- words --------------------------------- */

async function getAllWords() {
  return reqToPromise((await store("words", "readonly")).getAll());
}

async function getWord(id) {
  return reqToPromise((await store("words", "readonly")).get(id));
}

async function putWord(word) {
  return reqToPromise((await store("words", "readwrite")).put(word));
}

async function putWords(words) {
  const s = await store("words", "readwrite");
  await Promise.all(words.map((w) => reqToPromise(s.put(w))));
}

async function deleteWord(id) {
  return reqToPromise((await store("words", "readwrite")).delete(id));
}

async function getWordsByGroup(groupId) {
  return reqToPromise((await store("words", "readonly")).index("groupIds").getAll(groupId));
}

async function getWordsByKanji(kanji) {
  return reqToPromise((await store("words", "readonly")).index("kanjiList").getAll(kanji));
}

/* --------------------------------- groups ---------------------------------- */

async function getAllGroups() {
  return reqToPromise((await store("groups", "readonly")).getAll());
}

async function getGroup(id) {
  return reqToPromise((await store("groups", "readonly")).get(id));
}

async function putGroup(group) {
  return reqToPromise((await store("groups", "readwrite")).put(group));
}

async function putGroups(groups) {
  const s = await store("groups", "readwrite");
  await Promise.all(groups.map((g) => reqToPromise(s.put(g))));
}

async function deleteGroup(id) {
  return reqToPromise((await store("groups", "readwrite")).delete(id));
}

/* -------------------------------- kanjiMeta -------------------------------- */

async function getAllKanjiMeta() {
  return reqToPromise((await store("kanjiMeta", "readonly")).getAll());
}

async function getKanjiMeta(char) {
  return reqToPromise((await store("kanjiMeta", "readonly")).get(char));
}

async function putKanjiMeta(meta) {
  return reqToPromise((await store("kanjiMeta", "readwrite")).put(meta));
}
