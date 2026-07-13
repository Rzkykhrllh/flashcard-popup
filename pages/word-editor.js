// word-editor.js — the "Words" tab's add/edit word modal + kanji detail modal
// (internal id stays "list", only the displayed tab label changed to "Words").
// Loaded alongside db.js, kanji.js, vocab-bank.js, kanji-tab.js, graph.js,
// options.js on the same page — all classic <script> tags sharing one global
// scope, so top-level names here must not collide with the others.
//
// Kanji detail (on'yomi/kun'yomi) comes from data/kanjidic.json, a compact
// derivative of KANJIDIC2 (Electronic Dictionary Research and Development
// Group, CC BY-SA 4.0 — see README.md for attribution). Fetched lazily and
// cached on first kanji card open, since not every session opens one. Kanji
// *meaning* is separate — user-entered only, stored in IndexedDB's
// `kanjiMeta` store, never auto-filled from the dictionary.

let kanjidicPromise = null;
function loadKanjidic() {
  if (!kanjidicPromise) {
    kanjidicPromise = fetch(chrome.runtime.getURL("data/kanjidic.json")).then((r) => r.json());
  }
  return kanjidicPromise;
}

const addWordBtn = document.getElementById("addWordBtn");
const wordModalOverlay = document.getElementById("wordModalOverlay");
const wordModalClose = document.getElementById("wordModalClose");
const wordView = document.getElementById("wordView");
const wvFurigana = document.getElementById("wvFurigana");
const wvKanji = document.getElementById("wvKanji");
const wvMeaning = document.getElementById("wvMeaning");
const wvDivider = document.getElementById("wvDivider");
const wvExampleSection = document.getElementById("wvExampleSection");
const wvExample = document.getElementById("wvExample");
const wvNotesSection = document.getElementById("wvNotesSection");
const wvNotes = document.getElementById("wvNotes");
const wordForm = document.getElementById("wordForm");
const wordModalTitle = document.getElementById("wordModalTitle");
const wKanji = document.getElementById("wKanji");
const wHiragana = document.getElementById("wHiragana");
const wArti = document.getElementById("wArti");
const wExample = document.getElementById("wExample");
const wNotes = document.getElementById("wNotes");
const wGroupField = document.getElementById("wGroupField");
const wGroupSelect = document.getElementById("wGroupSelect");
const wNewGroupName = document.getElementById("wNewGroupName");
const wKanjiChips = document.getElementById("wKanjiChips");
const wStatus = document.getElementById("wStatus");
const wEditBtn = document.getElementById("wEditBtn");
const wSaveBtn = document.getElementById("wSaveBtn");
const wDeleteBtn = document.getElementById("wDeleteBtn");

const kanjiModalOverlay = document.getElementById("kanjiModalOverlay");
const kModalChar = document.getElementById("kModalChar");
const kModalClose = document.getElementById("kModalClose");
const kMeaningInput = document.getElementById("kMeaningInput");
const kNotesInput = document.getElementById("kNotesInput");
const kMeaningSaveBtn = document.getElementById("kMeaningSaveBtn");
const kOn = document.getElementById("kOn");
const kKun = document.getElementById("kKun");
const kRelated = document.getElementById("kRelated");

let editingId = null;
let currentKanjiChar = null;

function renderKanjiChips(kanjiList) {
  if (!kanjiList.length) { wKanjiChips.innerHTML = ""; return; }
  wKanjiChips.innerHTML = kanjiList
    .map((k) => `<button type="button" class="kanji-chip" data-k="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
    .join("");
  wKanjiChips.querySelectorAll(".kanji-chip").forEach((btn) => {
    btn.addEventListener("click", () => openKanjiModal(btn.dataset.k));
  });
}

// Renders `text` with each kanji character wrapped in a clickable span
// (opens the kanji detail modal); non-kanji characters (okurigana etc.) are
// plain text.
function renderKanjiInline(el, text) {
  el.innerHTML = [...(text || "")]
    .map((ch) => (extractKanjiList(ch).length
      ? `<span class="wv-k-char" data-k="${escapeHtml(ch)}">${escapeHtml(ch)}</span>`
      : escapeHtml(ch)))
    .join("");
  el.querySelectorAll(".wv-k-char").forEach((span) => {
    span.addEventListener("click", () => openKanjiModal(span.dataset.k));
  });
}

function showWordView(word) {
  wordView.style.display = "";
  wordForm.style.display = "none";
  wEditBtn.style.display = "";
  wSaveBtn.style.display = "none";
  wDeleteBtn.style.display = "";

  wvFurigana.textContent = word.hiragana || "";
  renderKanjiInline(wvKanji, word.kanji || "");
  wvMeaning.textContent = word.arti || "";

  wvExample.textContent = word.example || "";
  wvExampleSection.style.display = word.example ? "block" : "none";
  wvNotes.textContent = word.notes || "";
  wvNotesSection.style.display = word.notes ? "block" : "none";
  wvDivider.style.display = (word.example || word.notes) ? "block" : "none";
}

function showWordForm() {
  wordView.style.display = "none";
  wordForm.style.display = "";
  wEditBtn.style.display = "none";
  wSaveBtn.style.display = "";
  wDeleteBtn.style.display = editingId ? "" : "none";
  wKanji.focus();
}

function openWordModal(word) {
  editingId = word ? word.id : null;
  wordModalTitle.textContent = word ? "Edit word" : "Add word";
  wKanji.value = word ? word.kanji || "" : "";
  wHiragana.value = word ? word.hiragana || "" : "";
  wArti.value = word ? word.arti || "" : "";
  wExample.value = word ? word.example || "" : "";
  wNotes.value = word ? word.notes || "" : "";
  wStatus.textContent = "";

  if (word) {
    // Editing an existing word doesn't touch collection membership here —
    // that's a bigger feature (reassigning groups) not in scope yet.
    wGroupField.style.display = "none";
    wNewGroupName.style.display = "none";
  } else {
    wGroupField.style.display = "";
    wGroupSelect.innerHTML = [
      ...allGroups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`),
      `<option value="__new__">加 New collection…</option>`,
    ].join("");
    wNewGroupName.style.display = "none";
    wNewGroupName.value = "";
  }

  renderKanjiChips(word ? (word.kanjiList || extractKanjiList(word.kanji)) : extractKanjiList(wKanji.value));

  if (word) showWordView(word);
  else showWordForm();

  wordModalOverlay.classList.add("open");
}

function closeWordModal() {
  wordModalOverlay.classList.remove("open");
  editingId = null;
}

wKanji.addEventListener("input", () => renderKanjiChips(extractKanjiList(wKanji.value)));

wGroupSelect.addEventListener("change", () => {
  wNewGroupName.style.display = wGroupSelect.value === "__new__" ? "" : "none";
});

addWordBtn.addEventListener("click", () => openWordModal(null));
wEditBtn.addEventListener("click", showWordForm);
wordModalClose.addEventListener("click", closeWordModal);
wordModalOverlay.addEventListener("click", (e) => { if (e.target === wordModalOverlay) closeWordModal(); });

wordRowsEl.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const word = allWords.find((w) => w.id === tr.dataset.id);
  if (word) openWordModal(word);
});

wSaveBtn.addEventListener("click", async () => {
  const kanji = wKanji.value.trim();
  const hiragana = wHiragana.value.trim();
  const arti = wArti.value.trim();
  const example = wExample.value.trim();
  const notes = wNotes.value.trim();

  if (!kanji) { wStatus.textContent = "Kanji can't be empty."; return; }

  const newId = `${kanji}|${hiragana}`;

  if (editingId) {
    const existing = await getWord(editingId);
    if (!existing) { wStatus.textContent = "This word no longer exists."; return; }

    if (newId === editingId) {
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti;
      existing.example = example; existing.notes = notes;
      existing.kanjiList = extractKanjiList(kanji);
      await putWord(existing);
    } else {
      // Kanji/reading changed -> the id (kanji|hiragana) changed. IndexedDB
      // keys by that id, so this is a delete-old + put-new, not an in-place
      // rename. If the new id already belongs to a different word, merge
      // into it instead of silently clobbering — keep whichever side's
      // review progress is further along (same rule as the migration
      // collision handling in core/migrate.js), not just whichever record
      // happened to already occupy newId.
      const collision = await getWord(newId);
      let target;
      if (collision) {
        const ok = confirm(`"${kanji}${hiragana ? " / " + hiragana : ""}" already exists as a different word. Merge into it?`);
        if (!ok) return;
        const existingWins = (existing.n || 0) > (collision.n || 0)
          || ((existing.n || 0) === (collision.n || 0) && (existing.seen || 0) > (collision.seen || 0));
        target = { ...(existingWins ? existing : collision) };
        target.groupIds = [...new Set([...(collision.groupIds || []), ...(existing.groupIds || [])])];
      } else {
        target = { ...existing };
      }
      target.id = newId;
      target.kanji = kanji; target.hiragana = hiragana; target.arti = arti;
      target.example = example; target.notes = notes;
      target.kanjiList = extractKanjiList(kanji);
      await deleteWord(editingId);
      await putWord(target);
    }
  } else {
    let groupId = wGroupSelect.value;
    if (groupId === "__new__") {
      const name = wNewGroupName.value.trim();
      if (!name) { wStatus.textContent = "Collection name can't be empty."; return; }
      groupId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await putGroup({ id: groupId, name, type: "manual", sourceSheetUrl: null });
    }
    if (!groupId) { wStatus.textContent = "Pick a collection."; return; }

    const existing = await getWord(newId);
    if (existing) {
      const ok = confirm(`"${kanji}${hiragana ? " / " + hiragana : ""}" already exists. Update it and add to this collection?`);
      if (!ok) return;
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti;
      existing.example = example; existing.notes = notes;
      existing.kanjiList = extractKanjiList(kanji);
      existing.groupIds = [...new Set([...(existing.groupIds || []), groupId])];
      await putWord(existing);
    } else {
      await putWord({
        id: newId, kanji, hiragana, arti, example, notes,
        kanjiList: extractKanjiList(kanji),
        seen: 0, known: 0, hint: 0, forgot: 0, lastSeen: 0, createdAt: Date.now(),
        n: 0, easeFactor: 2.5, status: "new", statusOverride: false,
        source: "manual", groupIds: [groupId],
      });
    }
  }

  closeWordModal();
  await reloadData();
});

wDeleteBtn.addEventListener("click", async () => {
  if (!editingId) return;
  const ok = confirm(`Delete "${wKanji.value}" from the bank? This can't be undone unless you have a backup export.`);
  if (!ok) return;
  await deleteWord(editingId);
  closeWordModal();
  await reloadData();
});

async function openKanjiModal(k) {
  currentKanjiChar = k;
  kModalChar.textContent = k;
  kMeaningInput.value = "";
  kNotesInput.value = "";
  kOn.innerHTML = '<span class="reading-pill">Loading…</span>';
  kKun.innerHTML = "";

  const related = allWords.filter((w) => (w.kanjiList || []).includes(k) && w.id !== editingId);
  kRelated.innerHTML = related.length
    ? related.map((w) => `
        <div class="wl-row" data-id="${escapeHtml(w.id)}">
          <span class="wl-k">${escapeHtml(w.kanji)}</span>
          <span class="wl-r">${escapeHtml(w.hiragana || "")}</span>
          <span class="wl-m">${escapeHtml(w.arti || "")}</span>
        </div>`).join("")
    : '<p class="empty">No other words use this kanji yet.</p>';
  kRelated.querySelectorAll(".wl-row").forEach((row) => {
    row.addEventListener("click", () => {
      const w = allWords.find((x) => x.id === row.dataset.id);
      if (w) { closeKanjiModal(); openWordModal(w); }
    });
  });

  kanjiModalOverlay.classList.add("open");

  const meta = await getKanjiMeta(k);
  kMeaningInput.value = meta ? meta.meaning || "" : "";
  kNotesInput.value = meta ? meta.notes || "" : "";

  const dict = await loadKanjidic();
  const entry = dict[k];
  kOn.innerHTML = entry && entry.on && entry.on.length
    ? entry.on.map((r) => `<span class="reading-pill">${escapeHtml(r)}</span>`).join("")
    : '<p class="empty">—</p>';
  kKun.innerHTML = entry && entry.kun && entry.kun.length
    ? entry.kun.map((r) => `<span class="reading-pill">${escapeHtml(r)}</span>`).join("")
    : '<p class="empty">—</p>';
}

function closeKanjiModal() {
  kanjiModalOverlay.classList.remove("open");
  currentKanjiChar = null;
}

kMeaningSaveBtn.addEventListener("click", async () => {
  if (!currentKanjiChar) return;
  await putKanjiMeta({
    char: currentKanjiChar,
    meaning: kMeaningInput.value.trim(),
    notes: kNotesInput.value.trim(),
  });
  kMeaningSaveBtn.textContent = "Saved";
  setTimeout(() => { kMeaningSaveBtn.textContent = "Save"; }, 1200);
  if (typeof renderKanjiTab === "function") renderKanjiTab();
});

kModalClose.addEventListener("click", closeKanjiModal);
kanjiModalOverlay.addEventListener("click", (e) => { if (e.target === kanjiModalOverlay) closeKanjiModal(); });

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (kanjiModalOverlay.classList.contains("open")) closeKanjiModal();
  else if (wordModalOverlay.classList.contains("open")) closeWordModal();
});
