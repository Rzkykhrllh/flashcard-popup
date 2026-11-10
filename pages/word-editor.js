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
const wIncludeField = document.getElementById("wIncludeField");
const wIncludeInStudy = document.getElementById("wIncludeInStudy");
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

// A word can belong to any number of collections at once (groupIds is an
// array). The shared picker (core/collection-picker.js) handles search,
// creating a collection from the search box, renaming, and the selected
// state. Add mode pre-selects the collections used on the last save (same
// memory as the toolbar quick-add); Edit mode shows the word's own.
const LAST_COLLECTIONS_KEY = "lastCollectionIds";

const wPicker = createCollectionPicker(document.getElementById("wCollections"), {
  onCreate: async (name) => {
    const group = { id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, type: "manual", sourceSheetUrl: null };
    await putGroup(group);
    allGroups.push(group);
    reloadData();
    return group;
  },
  onRename: async (groupId, name) => {
    await send({ type: "renameGroup", groupId, name });
    const g = allGroups.find((x) => x.id === groupId);
    if (g) g.name = name;
    reloadData(); // keep the Words tab's own group filter dropdown in sync too
  },
});

function selectedGroupIds() {
  return wPicker.getSelected();
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
  wPicker.setGroups(allGroups);
  wPicker.reset();
  if (word) wPicker.setSelected(word.groupIds || []);
  else chrome.storage.local.get(LAST_COLLECTIONS_KEY).then((r) => { if (!editingId) wPicker.setSelected(r[LAST_COLLECTIONS_KEY] || []); });
  wIncludeField.style.display = word ? "none" : "";
  wIncludeInStudy.checked = true;

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

addWordBtn.addEventListener("click", () => openWordModal(null));
wEditBtn.addEventListener("click", showWordForm);
wordModalClose.addEventListener("click", closeWordModal);
// Deliberately no click-outside-to-close and no Escape-to-close here (see the
// keydown handler below) — this modal holds a multi-field form, and closing
// it via an accidental outside click or Escape while typing discarded
// in-progress entries. Only the explicit X button closes it now.

wordRowsEl.addEventListener("click", (e) => {
  // "In Study" switch — guards on .switch (the wrapping label), not
  // .word-eligible-cb (the actual checkbox): the checkbox itself is visually
  // hidden (options.css's .switch input), so a real click lands on the
  // visible .slider span, a sibling of .word-eligible-cb, not a descendant
  // of it. closest(".word-eligible-cb") would miss that click and let it
  // fall through to openWordModal below.
  if (e.target.closest(".switch")) return;
  // Bulk-select checkbox (vocab-bank.js) — must not also open the edit
  // modal. Its own click handler calls stopPropagation(), but that only
  // stops the event from bubbling to ancestors; it does nothing for a
  // second listener bound directly to this same element (this one), so the
  // guard has to live here too.
  if (e.target.closest(".row-select-cb")) return;
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

  const groupIds = selectedGroupIds();
  if (!groupIds.length) { wStatus.textContent = "Pick at least one collection."; return; }

  const newId = `${kanji}|${hiragana}`;

  if (editingId) {
    const existing = await getWord(editingId);
    if (!existing) { wStatus.textContent = "This word no longer exists."; return; }

    if (newId === editingId) {
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti;
      existing.example = example; existing.notes = notes;
      existing.kanjiList = extractKanjiList(kanji);
      existing.groupIds = groupIds;
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
        // Union with the collision target's own memberships too — merging
        // into it shouldn't strip whatever collections it already belonged to.
        target.groupIds = [...new Set([...groupIds, ...(collision.groupIds || [])])];
      } else {
        target = { ...existing };
        target.groupIds = groupIds;
      }
      target.id = newId;
      target.kanji = kanji; target.hiragana = hiragana; target.arti = arti;
      target.example = example; target.notes = notes;
      target.kanjiList = extractKanjiList(kanji);
      await deleteWord(editingId);
      await putWord(target);
    }
  } else {
    const existing = await getWord(newId);
    if (existing) {
      const ok = confirm(`"${kanji}${hiragana ? " / " + hiragana : ""}" already exists. Update it and add to these collections?`);
      if (!ok) return;
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti;
      existing.example = example; existing.notes = notes;
      existing.kanjiList = extractKanjiList(kanji);
      existing.groupIds = [...new Set([...(existing.groupIds || []), ...groupIds])];
      await putWord(existing);
    } else {
      await putWord({
        id: newId, kanji, hiragana, arti, example, notes,
        kanjiList: extractKanjiList(kanji),
        seen: 0, known: 0, hint: 0, forgot: 0, lastSeen: 0, createdAt: Date.now(),
        n: 0, easeFactor: 2.5, status: "new", statusOverride: false,
        source: "manual", groupIds,
      });
    }
    for (const groupId of groupIds) {
      await send({ type: "setCardSelection", deckId: groupId, key: newId, selected: wIncludeInStudy.checked });
    }
    await chrome.storage.local.set({ [LAST_COLLECTIONS_KEY]: groupIds });
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

  const related = allWords.filter((w) => (w.kanjiList || []).includes(k));
  kRelated.innerHTML = related.length
    ? related.map((w) => `
        <div class="wl-row" data-id="${escapeHtml(w.id)}">
          <span class="wl-k">${escapeHtml(w.kanji)}</span>
          <span class="wl-r">${escapeHtml(w.hiragana || "")}</span>
          <span class="wl-m">${escapeHtml(w.arti || "")}</span>
        </div>`).join("")
    : '<p class="empty">No words use this kanji yet.</p>';
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
  // Word modal is excluded on purpose — see the comment by wordModalClose above.
  if (kanjiModalOverlay.classList.contains("open")) closeKanjiModal();
});
