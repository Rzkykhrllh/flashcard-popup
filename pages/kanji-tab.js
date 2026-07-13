// kanji-tab.js — the "Kanji" tab: every kanji character used across the
// bank's words, with auto on'yomi/kun'yomi (data/kanjidic.json) and a
// user-editable meaning (IndexedDB `kanjiMeta`, via word-editor.js's kanji
// modal — clicking a row here opens that same modal).

const kanjiRowsEl = document.getElementById("kanjiRows");
const kanjiEmptyStateEl = document.getElementById("kanjiEmptyState");
const kanjiSearchInputEl = document.getElementById("kanjiSearchInput");

let kanjiTabQuery = "";
const KANJI_TABLE_WORD_PREVIEW = 6; // rest is still reachable via the kanji card's full list

function kanjiWordIndex() {
  const index = new Map(); // char -> words[]
  for (const w of allWords) {
    for (const c of w.kanjiList || []) {
      if (!index.has(c)) index.set(c, []);
      index.get(c).push(w);
    }
  }
  return index;
}

async function renderKanjiTab() {
  const [metaList, dict] = await Promise.all([getAllKanjiMeta(), loadKanjidic()]);
  const metaByChar = new Map(metaList.map((m) => [m.char, m]));
  const wordIndex = kanjiWordIndex();

  const q = kanjiTabQuery.trim().toLowerCase();
  const chars = [...wordIndex.keys()]
    .filter((c) => !q || c.includes(q) || (metaByChar.get(c)?.meaning || "").toLowerCase().includes(q))
    .sort((a, b) => wordIndex.get(b).length - wordIndex.get(a).length);

  kanjiRowsEl.innerHTML = chars
    .map((c) => {
      const entry = dict[c];
      const on = entry && entry.on && entry.on.length ? entry.on.join("、") : "";
      const kun = entry && entry.kun && entry.kun.length ? entry.kun.join("、") : "";
      const readings = [on, kun].filter(Boolean).join(" / ") || "—";
      const meaning = metaByChar.get(c)?.meaning || "—";

      const words = wordIndex.get(c);
      const shown = words.slice(0, KANJI_TABLE_WORD_PREVIEW).map((w) => escapeHtml(w.kanji)).join("、");
      const rest = words.length - KANJI_TABLE_WORD_PREVIEW;
      const wordsHtml = shown + (rest > 0 ? ` <span class="cell-muted">+${rest} more</span>` : "");

      return `
        <tr data-k="${escapeHtml(c)}">
          <td class="kanji-cell">${escapeHtml(c)}</td>
          <td class="reading-cell kt-readings">${escapeHtml(readings)}</td>
          <td>${escapeHtml(meaning)}</td>
          <td class="kt-words">${wordsHtml}</td>
        </tr>`;
    })
    .join("");

  kanjiEmptyStateEl.style.display = chars.length ? "none" : "block";
}

kanjiRowsEl.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-k]");
  if (tr) openKanjiModal(tr.dataset.k);
});

kanjiSearchInputEl.addEventListener("input", () => {
  kanjiTabQuery = kanjiSearchInputEl.value;
  renderKanjiTab();
});
