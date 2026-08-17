// vocab-bank.js — the "Words" tab in options.html (internal id stays "list"):
// browse/filter view over the IndexedDB `words`/`groups` store. Also owns the
// export/import handlers, even though that markup now lives in the Settings
// tab's "Words" section — getElementById works across the whole page
// regardless of which tab-pane an element is in. Loaded alongside options.js,
// core/db.js and graph.js on the same page — all classic <script> tags
// sharing one global scope, so top-level names here must not collide with
// the others (see the GRAPH_STATUS_LABEL / renderList naming).

const GENERAL_GROUP = { id: "", name: "All (General)" };
const STATUS_LABEL = { new: "New", learning: "Learning", mastered: "Mastered" };

const statusTabsEl = document.getElementById("statusTabs");
const groupSelectEl = document.getElementById("groupSelect");
const searchInputEl = document.getElementById("searchInput");
const wordRowsEl = document.getElementById("wordRows");
const emptyStateEl = document.getElementById("emptyState");
const resultCountEl = document.getElementById("resultCount");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileEl = document.getElementById("importFile");
const backupStatusEl = document.getElementById("backupStatus");
const selectAllRowsEl = document.getElementById("selectAllRows");
const bulkBarEl = document.getElementById("bulkBar");
const bulkCountEl = document.getElementById("bulkCount");
const bulkAddBtn = document.getElementById("bulkAddBtn");
const bulkClearBtn = document.getElementById("bulkClearBtn");
const bulkAddModalOverlay = document.getElementById("bulkAddModalOverlay");
const bulkAddModalClose = document.getElementById("bulkAddModalClose");
const bulkAddCountEl = document.getElementById("bulkAddCount");
const bulkAddGroupListEl = document.getElementById("bulkAddGroupList");
const bulkAddNewGroupName = document.getElementById("bulkAddNewGroupName");
const bulkAddNewGroupBtn = document.getElementById("bulkAddNewGroupBtn");
const bulkAddStatusEl = document.getElementById("bulkAddStatus");

let allWords = [];
let allGroups = [];
let activeStatus = "";
let activeGroupId = "";
let activeQuery = "";

// Eligibility ("show in Study/popup") isn't stored on the word itself — it
// lives in background.js's getState().selection, keyed by category id (see
// options.js's isWordEligible/setWordSelection, reused here as-is rather
// than re-implementing the "explicit false excludes" rule a third time).
// Cached instead of fetched per-render so typing in the search box doesn't
// round-trip to the background page on every keystroke.
let stateCache = null;

async function refreshStateCache() {
  stateCache = await send({ type: "getState" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function statusBadge(status) {
  return `<span class="status-badge status-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function groupNames(word) {
  if (!word.groupIds || !word.groupIds.length) return "—";
  return word.groupIds
    .map((id) => (allGroups.find((g) => g.id === id) || {}).name || id)
    .join(", ");
}

function updateCounts() {
  document.getElementById("count-all").textContent = allWords.length;
  for (const status of ["new", "learning", "mastered"]) {
    document.getElementById(`count-${status}`).textContent =
      allWords.filter((w) => w.status === status).length;
  }
}

// Bulk-select: word ids checked via the leading checkbox column, so several
// words can be added to a collection in one action instead of opening each
// one's edit form individually (see bulkAddGroupListEl's click handler
// below). Purely a UI selection, separate from — and with no effect on —
// study eligibility (the existing "In Study" column/checkbox).
let bulkSelectedIds = new Set();

function updateBulkBar() {
  const n = bulkSelectedIds.size;
  bulkBarEl.style.display = n ? "flex" : "none";
  bulkCountEl.textContent = n ? `${n} selected` : "";
}

function renderList() {
  const q = activeQuery.trim().toLowerCase();
  const filtered = allWords.filter((w) => {
    if (activeStatus && w.status !== activeStatus) return false;
    if (activeGroupId && !(w.groupIds || []).includes(activeGroupId)) return false;
    if (q) {
      const hay = `${w.kanji || ""} ${w.hiragana || ""} ${w.arti || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  wordRowsEl.innerHTML = filtered
    .map((w) => {
      const entry = { key: w.id, deckIds: w.groupIds || [] };
      const checked = stateCache && entry.deckIds.length ? isWordEligible(stateCache, entry) : false;
      const selected = bulkSelectedIds.has(w.id);
      return `
      <tr data-id="${escapeHtml(w.id)}">
        <td><input type="checkbox" class="row-select-cb" ${selected ? "checked" : ""} /></td>
        <td class="kanji-cell">${escapeHtml(w.kanji || "")}</td>
        <td class="reading-cell">${escapeHtml(w.hiragana || "")}</td>
        <td>${escapeHtml(w.arti || "")}</td>
        <td>${statusBadge(w.status)}</td>
        <td class="cell-muted">${escapeHtml(groupNames(w))}</td>
        <td><label class="switch"><input type="checkbox" class="word-eligible-cb" ${checked ? "checked" : ""} /><span class="slider"></span></label></td>
      </tr>`;
    })
    .join("");

  emptyStateEl.style.display = filtered.length ? "none" : "block";
  emptyStateEl.textContent = allWords.length ? "No words match." : "No words here yet.";
  resultCountEl.textContent = allWords.length ? `${filtered.length} of ${allWords.length}` : "";

  // "select all" reflects the *visible* (filtered) rows only, same scope the
  // checkbox itself selects/deselects — see its own change handler below.
  const visibleIds = filtered.map((w) => w.id);
  selectAllRowsEl.checked = visibleIds.length > 0 && visibleIds.every((id) => bulkSelectedIds.has(id));
  updateBulkBar();
}

wordRowsEl.addEventListener("change", async (e) => {
  const selectCb = e.target.closest(".row-select-cb");
  if (selectCb) {
    const tr = selectCb.closest("tr[data-id]");
    if (selectCb.checked) bulkSelectedIds.add(tr.dataset.id);
    else bulkSelectedIds.delete(tr.dataset.id);
    // Only the "select all" checkbox's own state needs to refresh here — a
    // full renderList() would rebuild every row and lose scroll position for
    // no reason, since nothing else about the rows changed.
    const visibleIds = [...wordRowsEl.querySelectorAll("tr[data-id]")].map((r) => r.dataset.id);
    selectAllRowsEl.checked = visibleIds.length > 0 && visibleIds.every((id) => bulkSelectedIds.has(id));
    updateBulkBar();
    return;
  }

  const cb = e.target.closest(".word-eligible-cb");
  if (!cb) return;
  const tr = cb.closest("tr[data-id]");
  const word = allWords.find((w) => w.id === tr.dataset.id);
  if (!word) return;
  await setWordSelection({ key: word.id, deckIds: word.groupIds || [] }, cb.checked);
  await refreshStateCache();
  renderList();
});

wordRowsEl.addEventListener("click", (e) => {
  // Prevent the row-open-modal handler in word-editor.js from also firing
  // for clicks on the new select checkbox (it already ignores
  // .word-eligible-cb the same way — see that file's own listener).
  if (e.target.closest(".row-select-cb")) e.stopPropagation();
});

selectAllRowsEl.addEventListener("change", () => {
  const visibleIds = [...wordRowsEl.querySelectorAll("tr[data-id]")].map((r) => r.dataset.id);
  if (selectAllRowsEl.checked) visibleIds.forEach((id) => bulkSelectedIds.add(id));
  else visibleIds.forEach((id) => bulkSelectedIds.delete(id));
  renderList();
});

bulkClearBtn.addEventListener("click", () => {
  bulkSelectedIds.clear();
  renderList();
});

function openBulkAddModal() {
  bulkAddCountEl.textContent = bulkSelectedIds.size;
  bulkAddStatusEl.textContent = "";
  bulkAddNewGroupName.value = "";
  renderBulkAddGroupList();
  bulkAddModalOverlay.classList.add("open");
}

function closeBulkAddModal() {
  bulkAddModalOverlay.classList.remove("open");
  // Selection is scoped to "words I'm about to file somewhere" — once the
  // modal that does the filing closes, there's no reason to keep holding it,
  // and leaving it checked risks a second accidental add-to-collection on
  // stale rows if the words/group list changed underneath in the meantime.
  bulkSelectedIds.clear();
  renderList();
}

function renderBulkAddGroupList() {
  bulkAddGroupListEl.innerHTML = allGroups.length
    ? allGroups.map((g) => `
        <div class="group-check-row" data-id="${escapeHtml(g.id)}">
          <span class="group-check-label">${escapeHtml(g.name)}</span>
          <button type="button" class="btn" data-add-to="${escapeHtml(g.id)}">Add</button>
        </div>`).join("")
    : '<p class="empty" style="margin:2px 0">No collections yet — create one below.</p>';

  bulkAddGroupListEl.querySelectorAll("[data-add-to]").forEach((btn) => {
    btn.addEventListener("click", () => addSelectedWordsToGroup(btn.dataset.addTo));
  });
}

bulkAddBtn.addEventListener("click", openBulkAddModal);
bulkAddModalClose.addEventListener("click", closeBulkAddModal);

bulkAddNewGroupBtn.addEventListener("click", async () => {
  const name = bulkAddNewGroupName.value.trim();
  if (!name) return;
  const groupId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const group = { id: groupId, name, type: "manual", sourceSheetUrl: null };
  await putGroup(group);
  allGroups.push(group);
  bulkAddNewGroupName.value = "";
  renderBulkAddGroupList();
  await addSelectedWordsToGroup(groupId);
});

// Adds every currently bulk-selected word to `groupId` — a union onto each
// word's existing groupIds, same merge rule as the per-word checklist in
// word-editor.js/popup.js. Words already in the collection are silently
// skipped (the Set dedupes), nothing about their existing memberships or
// study eligibility changes. Modal stays open afterward so you can add the
// same selection to a second collection too, if you want; the group filter
// dropdown and Words table refresh right away either way.
async function addSelectedWordsToGroup(groupId) {
  const group = allGroups.find((g) => g.id === groupId);
  if (!group || !bulkSelectedIds.size) return;

  let added = 0;
  for (const id of bulkSelectedIds) {
    const word = allWords.find((w) => w.id === id) || await getWord(id);
    if (!word) continue;
    if ((word.groupIds || []).includes(groupId)) continue; // already there
    word.groupIds = [...(word.groupIds || []), groupId];
    await putWord(word);
    added++;
  }

  bulkAddStatusEl.textContent = added
    ? `Added ${added} word(s) to "${group.name}".`
    : `Selected word(s) were already in "${group.name}".`;

  await reloadData();
  bulkAddCountEl.textContent = bulkSelectedIds.size; // reloadData() doesn't touch the selection itself
}

statusTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".status-tab");
  if (!btn) return;
  activeStatus = btn.dataset.status;
  for (const b of statusTabsEl.querySelectorAll(".status-tab")) b.classList.toggle("active", b === btn);
  renderList();
});

groupSelectEl.addEventListener("change", () => {
  activeGroupId = groupSelectEl.value;
  renderList();
});

searchInputEl.addEventListener("input", () => {
  activeQuery = searchInputEl.value;
  renderList();
});

// Tab switching (Settings / List / Study / Graph) is owned by options.js's
// switchTab() — it calls renderList()/startGraph() when those tabs are shown,
// the same way it already calls renderStats()/renderStudy().

async function reloadData() {
  allWords = await getAllWords();
  allGroups = await getAllGroups();
  await refreshStateCache();

  groupSelectEl.innerHTML = [GENERAL_GROUP, ...allGroups]
    .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
    .join("");

  // Drop any bulk-selected id that no longer exists (e.g. deleted elsewhere)
  // so the count in the bulk bar / modal never overstates what's left.
  const liveIds = new Set(allWords.map((w) => w.id));
  for (const id of bulkSelectedIds) if (!liveIds.has(id)) bulkSelectedIds.delete(id);

  updateCounts();
  renderList();
}

exportBtn.addEventListener("click", async () => {
  const words = await getAllWords();
  const groups = await getAllGroups();
  const payload = { exportedAt: Date.now(), words, groups };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kotoba-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  backupStatusEl.textContent = `Exported ${words.length} words, ${groups.length} groups.`;
});

importBtn.addEventListener("click", () => importFileEl.click());

importFileEl.addEventListener("change", async () => {
  const file = importFileEl.files[0];
  importFileEl.value = ""; // allow re-selecting the same file later
  if (!file) return;

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (e) {
    backupStatusEl.textContent = "Invalid JSON file.";
    return;
  }

  const words = Array.isArray(payload.words) ? payload.words : [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  if (!words.length && !groups.length) {
    backupStatusEl.textContent = "No words or groups found in this file.";
    return;
  }

  const existingIds = new Set(allWords.map((w) => w.id));
  const overwriteCount = words.filter((w) => existingIds.has(w.id)).length;
  const newCount = words.length - overwriteCount;

  const ok = confirm(
    `Import ${words.length} words & ${groups.length} groups?\n` +
    `${newCount} new, ${overwriteCount} will be overwritten (same id already exists).`
  );
  if (!ok) return;

  await putWords(words);
  await putGroups(groups);
  await reloadData();
  backupStatusEl.textContent = `Imported: ${newCount} new, ${overwriteCount} overwritten.`;
});

async function init() {
  await reloadData();
  document.dispatchEvent(new CustomEvent("kotoba:data-ready", { detail: { words: allWords, groups: allGroups } }));
}

init();
