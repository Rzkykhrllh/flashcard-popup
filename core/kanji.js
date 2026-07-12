// kanji.js — kanji extraction from word text.
// Shared by background.js (sync), migrate.js, and manual card add (later).
// Plain global functions — loaded via importScripts / <script>, no modules.

const KANJI_REGEX = /[一-龯]/g;

// Unique kanji characters found in `text`, in first-seen order.
// Hiragana/katakana/okurigana (e.g. the べる in 食べる) never match — the
// CJK ideograph Unicode block doesn't overlap the kana blocks.
function extractKanjiList(text) {
  const matches = String(text || "").match(KANJI_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}
