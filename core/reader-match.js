// reader-match.js — find Kotoba Bank words inside arbitrary page text.
//
// Pure functions, no DOM / chrome APIs: loaded as a content script before
// reader.js, and required directly by tests/reader-match.test.js under node.
//
// Two kinds of match:
//   - "exact":   the word's surface form appears verbatim (食べる in 食べる).
//   - "variant": the word's STEM appears, immediately followed by hiragana —
//                i.e. probably a conjugated form (食べ|た, 行|った, 勉強|した).
//                Shown as "similar to X", never as "this is X": the stem rule
//                is a hint, not a guarantee (生きる vs 生まれる share 生).
//
// Noise rules (see the design discussion in the feature branch):
//   A. Longest match wins; an exact match beats a variant at the same spot.
//   B. Only words containing at least one kanji are indexed — kana-only words
//      (する, とても) would light up half of any page.
//   C. A one-kanji word / one-kanji stem only matches when the character
//      BEFORE it isn't a kanji, and (for exact) the character AFTER it isn't
//      either — so 雨 matches in 「雨が降る」 but not inside 雨天 or 大雨.
//   F. Per-word ignore list (word ids), applied when the index is built.

// CJK unified ideographs (+ ext. A, compatibility) and the 々 iteration mark.
const READER_KANJI_RE = /[㐀-䶿一-鿿豈-﫿々]/;
const READER_HIRAGANA_RE = /[ぁ-ゖゝゞ]/;
// Any Japanese script — used to skip text nodes that can't possibly match.
const READER_JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿々ｦ-ﾟ]/;

// Max hiragana tacked onto a variant match. A conjugation tail is usually
// short (た / ない / られる); without a cap, trailing particles get swept in
// (食べたのは → whole thing underlined).
const VARIANT_TAIL_MAX = 4;

function readerIsKanji(ch) { return !!ch && READER_KANJI_RE.test(ch); }
function readerIsHiragana(ch) { return !!ch && READER_HIRAGANA_RE.test(ch); }
function readerHasJapanese(text) { return READER_JAPANESE_RE.test(text || ""); }

// Stem used for variant matching, or null when the word doesn't inflect in a
// way this rule can catch (nouns, words ending in kanji/katakana).
//   勉強する → 勉強   (suru-verb: drop する)
//   食べる   → 食べ   (drop the final hiragana)
//   行く     → 行
//   美しい   → 美し
// The stem must still contain a kanji, otherwise it's too generic to match on.
function readerStemOf(surface) {
  const s = String(surface || "");
  if (s.length < 2) return null;
  let stem;
  if (s.endsWith("する") && s.length > 2) stem = s.slice(0, -2);
  else if (readerIsHiragana(s[s.length - 1])) stem = s.slice(0, -1);
  else return null;
  if (![...stem].some(readerIsKanji)) return null;
  return stem;
}

// words: [{ id, kanji, hiragana, arti, status }]
// ignore: array/Set of word ids to leave out.
// Returns { byFirst: Map<char, candidate[]> } with each list sorted longest
// first, exact before variant on equal length.
function readerBuildIndex(words, ignore) {
  const ignored = new Set(ignore || []);
  const byFirst = new Map();
  const add = (str, kind, word) => {
    const list = byFirst.get(str[0]) || [];
    list.push({ str, kind, word });
    byFirst.set(str[0], list);
  };
  const seen = new Set(); // dedupe identical (str, kind) pairs from duplicate words
  for (const w of words || []) {
    if (!w || ignored.has(w.id)) continue;
    const surface = String(w.kanji || "").trim();
    if (!surface || ![...surface].some(readerIsKanji)) continue; // rule B
    const word = { id: w.id, kanji: surface, hiragana: w.hiragana || "", arti: w.arti || "", status: w.status || "new" };
    if (!seen.has("e|" + surface)) { seen.add("e|" + surface); add(surface, "exact", word); }
    const stem = readerStemOf(surface);
    if (stem && !seen.has("v|" + stem)) { seen.add("v|" + stem); add(stem, "variant", word); }
  }
  for (const list of byFirst.values()) {
    list.sort((a, b) => b.str.length - a.str.length || (a.kind === "exact" ? -1 : 1));
  }
  return { byFirst };
}

// Scan `text` and return non-overlapping matches:
// [{ start, end, kind: "exact" | "variant", word }]
function readerFindMatches(text, index) {
  const out = [];
  if (!text || !index || !index.byFirst.size) return out;
  let i = 0;
  while (i < text.length) {
    const list = index.byFirst.get(text[i]);
    let hit = null;
    if (list) {
      const prev = text[i - 1];
      // Pass 1: exact matches, longest first (rule A).
      for (const c of list) {
        if (c.kind !== "exact" || !text.startsWith(c.str, i)) continue;
        if (c.str.length === 1) { // rule C
          if (readerIsKanji(prev) || readerIsKanji(text[i + 1])) continue;
        }
        hit = { start: i, end: i + c.str.length, kind: "exact", word: c.word };
        break;
      }
      // Pass 2: variant — stem followed by hiragana.
      if (!hit) {
        for (const c of list) {
          if (c.kind !== "variant" || !text.startsWith(c.str, i)) continue;
          let j = i + c.str.length;
          if (!readerIsHiragana(text[j])) continue;
          if (c.str.length === 1 && readerIsKanji(prev)) continue; // rule C
          const stop = Math.min(text.length, j + VARIANT_TAIL_MAX);
          while (j < stop && readerIsHiragana(text[j])) j++;
          hit = { start: i, end: j, kind: "variant", word: c.word };
          break;
        }
      }
    }
    if (hit) { out.push(hit); i = hit.end; }
    else i++;
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { readerBuildIndex, readerFindMatches, readerStemOf, readerHasJapanese, readerIsKanji, readerIsHiragana };
}
