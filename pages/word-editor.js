// word-editor.js — the "List" tab's add/edit word modal + kanji detail modal.
// Loaded alongside db.js, kanji.js, vocab-bank.js, graph.js, options.js on the
// same page — all classic <script> tags sharing one global scope, so
// top-level names here must not collide with the others.
//
// Kanji detail (on'yomi/kun'yomi) comes from data/kanjidic.json, a compact
// derivative of KANJIDIC2 (Electronic Dictionary Research and Development
// Group, CC BY-SA 4.0 — see README.md for attribution). Fetched lazily and
// cached on first kanji card open, since not every session opens one.

let kanjidicPromise = null;
function loadKanjidic() {
  if (!kanjidicPromise) {
    kanjidicPromise = fetch(chrome.runtime.getURL("data/kanjidic.json")).then((r) => r.json());
  }
  return kanjidicPromise;
}

const addWordBtn = document.getElementById("addWordBtn");
const wordModalOverlay = document.getElementById("wordModalOverlay");
const wordModalTitle = document.getElementById("wordModalTitle");
const wordModalClose = document.getElementById("wordModalClose");
const wKanji = document.getElementById("wKanji");
const wHiragana = document.getElementById("wHiragana");
const wArti = document.getElementById("wArti");
const wNotes = document.getElementById("wNotes");
const wGroupField = document.getElementById("wGroupField");
const wGroupSelect = document.getElementById("wGroupSelect");
const wNewGroupName = document.getElementById("wNewGroupName");
const wKanjiChips = document.getElementById("wKanjiChips");
const wStatus = document.getElementById("wStatus");
const wSaveBtn = document.getElementById("wSaveBtn");
const wDeleteBtn = document.getElementById("wDeleteBtn");

const kanjiModalOverlay = document.getElementById("kanjiModalOverlay");
const kModalChar = document.getElementById("kModalChar");
const kModalClose = document.getElementById("kModalClose");
const kOn = document.getElementById("kOn");
const kKun = document.getElementById("kKun");
const kRelated = document.getElementById("kRelated");

let editingId = null;

function renderKanjiChips(kanjiList) {
  if (!kanjiList.length) { wKanjiChips.innerHTML = ""; return; }
  wKanjiChips.innerHTML = kanjiList
    .map((k) => `<button type="button" class="kanji-chip" data-k="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
    .join("");
  wKanjiChips.querySelectorAll(".kanji-chip").forEach((btn) => {
    btn.addEventListener("click", () => openKanjiModal(btn.dataset.k));
  });
}

function openWordModal(word) {
  editingId = word ? word.id : null;
  wordModalTitle.textContent = word ? "Edit word" : "Add word";
  wKanji.value = word ? word.kanji || "" : "";
  wHiragana.value = word ? word.hiragana || "" : "";
  wArti.value = word ? word.arti || "" : "";
  wNotes.value = word ? word.notes || "" : "";
  wStatus.textContent = "";
  wDeleteBtn.style.display = word ? "" : "none";

  if (word) {
    // Editing an existing word doesn't touch collection membership here —
    // that's a bigger feature (reassigning groups) not in scope yet.
    wGroupField.style.display = "none";
    wNewGroupName.style.display = "none";
  } else {
    wGroupField.style.display = "";
    wGroupSelect.innerHTML = [
      ...allGroups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`),
      `<option value="__new__">+ New collection…</option>`,
    ].join("");
    wNewGroupName.style.display = "none";
    wNewGroupName.value = "";
  }

  renderKanjiChips(word ? (word.kanjiList || extractKanjiList(word.kanji)) : extractKanjiList(wKanji.value));
  wordModalOverlay.classList.add("open");
  wKanji.focus();
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
  const notes = wNotes.value.trim();

  if (!kanji) { wStatus.textContent = "Kanji can't be empty."; return; }

  const newId = `${kanji}|${hiragana}`;

  if (editingId) {
    const existing = await getWord(editingId);
    if (!existing) { wStatus.textContent = "This word no longer exists."; return; }

    if (newId === editingId) {
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti; existing.notes = notes;
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
      target.kanji = kanji; target.hiragana = hiragana; target.arti = arti; target.notes = notes;
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
      existing.kanji = kanji; existing.hiragana = hiragana; existing.arti = arti; existing.notes = notes;
      existing.kanjiList = extractKanjiList(kanji);
      existing.groupIds = [...new Set([...(existing.groupIds || []), groupId])];
      await putWord(existing);
    } else {
      await putWord({
        id: newId, kanji, hiragana, arti, notes,
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
  kModalChar.textContent = k;
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
}

kModalClose.addEventListener("click", closeKanjiModal);
kanjiModalOverlay.addEventListener("click", (e) => { if (e.target === kanjiModalOverlay) closeKanjiModal(); });

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (kanjiModalOverlay.classList.contains("open")) closeKanjiModal();
  else if (wordModalOverlay.classList.contains("open")) closeWordModal();
});
