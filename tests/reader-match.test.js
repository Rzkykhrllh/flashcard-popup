// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { readerBuildIndex, readerFindMatches, readerStemOf } = require("../core/reader-match.js");

const W = (kanji, extra = {}) => ({ id: `${kanji}|x`, kanji, hiragana: "", arti: "", status: "learning", ...extra });
const find = (text, words, ignore) =>
  readerFindMatches(text, readerBuildIndex(words, ignore)).map((m) => `${m.kind}:${text.slice(m.start, m.end)}`);

test("stem rules", () => {
  assert.equal(readerStemOf("食べる"), "食べ");
  assert.equal(readerStemOf("行く"), "行");
  assert.equal(readerStemOf("美しい"), "美し");
  assert.equal(readerStemOf("勉強する"), "勉強");
  assert.equal(readerStemOf("時間"), null);       // noun, ends in kanji
  assert.equal(readerStemOf("する"), null);       // no kanji left
  assert.equal(readerStemOf("雨"), null);
});

test("exact match", () => {
  assert.deepEqual(find("毎朝パンを食べる。", [W("食べる")]), ["exact:食べる"]);
});

test("conjugated forms match as variants", () => {
  const words = [W("食べる"), W("行く"), W("勉強する")];
  assert.deepEqual(find("昨日すしを食べた", words), ["variant:食べた"]);
  assert.deepEqual(find("食べられない", words), ["variant:食べられない"]);
  assert.deepEqual(find("学校に行った", words), ["variant:行った"]);
  assert.deepEqual(find("日本語を勉強しました", words), ["variant:勉強しました"]);
});

test("stem followed by kanji is not a variant (行動 ≠ 行く)", () => {
  assert.deepEqual(find("行動する", [W("行く")]), []);
});

test("longest match wins (rule A)", () => {
  assert.deepEqual(find("時間がない", [W("時"), W("時間")]), ["exact:時間"]);
});

test("exact beats variant at the same position", () => {
  // 行く exact vs 行 stem — exact wins even though the variant tail could be longer.
  assert.deepEqual(find("行くのは", [W("行く")]), ["exact:行く"]);
});

test("kana-only words are never indexed (rule B)", () => {
  assert.deepEqual(find("とてもいいです", [W("とても")]), []);
});

test("single-kanji words need non-kanji neighbours (rule C)", () => {
  const words = [W("雨")];
  assert.deepEqual(find("雨が降る", words), ["exact:雨"]);
  assert.deepEqual(find("雨天中止", words), []);
  assert.deepEqual(find("大雨です", words), []);
});

test("single-kanji stem needs a non-kanji before it", () => {
  assert.deepEqual(find("旅行った", [W("行く")]), []);
  assert.deepEqual(find("また行った", [W("行く")]), ["variant:行った"]);
});

test("ignore list (rule F)", () => {
  const w = W("時間");
  assert.deepEqual(find("時間", [w], [w.id]), []);
});

test("multiple matches in one string, non-overlapping", () => {
  const words = [W("電車"), W("乗る"), W("時間")];
  assert.deepEqual(find("電車に乗って、時間通りに着いた", words), ["exact:電車", "variant:乗って", "exact:時間"]);
});

test("々 counts as kanji", () => {
  assert.deepEqual(find("時々行く", [W("時々")]), ["exact:時々"]);
});

test("variant tail is capped so trailing particles aren't swept in", () => {
  // 乗っ + たのは… → tail stops after 4 hiragana (っ た の は), not the whole run.
  assert.deepEqual(find("乗ったのはバスだ", [W("乗る")]), ["variant:乗ったのは"]);
  assert.deepEqual(find("乗ったのはずだ", [W("乗る")]), ["variant:乗ったのは"]);
});
