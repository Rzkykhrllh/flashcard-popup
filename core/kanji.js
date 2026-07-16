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

// String.prototype.trim() does NOT strip zero-width characters (ZWSP
// U+200B, ZWNJ U+200C, ZWJ U+200D, ZWNBSP/BOM U+FEFF) — only the
// ECMAScript "WhiteSpace"/"LineTerminator" set. A word whose kanji field is
// just one of these (plausible from a copy-pasted spreadsheet import) has
// `.trim().length > 0` despite being genuinely invisible on a flashcard, so
// a plain `!text.trim()` check misses it. This strips both whitespace and
// the common zero-width characters before testing for real content.
const INVISIBLE_RE = /[\s​-‍﻿]/g;
function hasVisibleText(text) {
  return String(text || "").replace(INVISIBLE_RE, "").length > 0;
}
