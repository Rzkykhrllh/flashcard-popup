// kanji-tab.js — the "Kanji" tab: every kanji character used across the
// bank's words, with auto on'yomi/kun'yomi (data/kanjidic.json) and a
// user-editable meaning (IndexedDB `kanjiMeta`, via word-editor.js's kanji
// modal — clicking a row here opens that same modal).

const kanjiRowsEl = document.getElementById("kanjiRows");
const kanjiEmptyStateEl = document.getElementById("kanjiEmptyState");
const kanjiSearchInputEl = document.getElementById("kanjiSearchInput");

let kanjiTabQuery = "";

function kanjiUsageCounts() {
  const counts = new Map();
  for (const w of allWords) {
    for (const c of w.kanjiList || []) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return counts;
}

async function renderKanjiTab() {
  const [metaList, dict] = await Promise.all([getAllKanjiMeta(), loadKanjidic()]);
  const metaByChar = new Map(metaList.map((m) => [m.char, m]));
  const counts = kanjiUsageCounts();

  const q = kanjiTabQuery.trim().toLowerCase();
  const chars = [...counts.keys()]
    .filter((c) => !q || c.includes(q) || (metaByChar.get(c)?.meaning || "").toLowerCase().includes(q))
    .sort((a, b) => counts.get(b) - counts.get(a));

  kanjiRowsEl.innerHTML = chars
    .map((c) => {
      const entry = dict[c];
      const on = entry && entry.on && entry.on.length ? entry.on.join("、") : "—";
      const kun = entry && entry.kun && entry.kun.length ? entry.kun.join("、") : "—";
      const meaning = metaByChar.get(c)?.meaning || "—";
      return `
        <tr data-k="${escapeHtml(c)}">
          <td class="kanji-cell">${escapeHtml(c)}</td>
          <td class="reading-cell">${escapeHtml(on)}</td>
          <td class="reading-cell">${escapeHtml(kun)}</td>
          <td>${escapeHtml(meaning)}</td>
          <td class="cell-muted">${counts.get(c)}</td>
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
