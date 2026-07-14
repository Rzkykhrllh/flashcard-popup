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
      return `
      <tr data-id="${escapeHtml(w.id)}">
        <td class="kanji-cell">${escapeHtml(w.kanji || "")}</td>
        <td class="reading-cell">${escapeHtml(w.hiragana || "")}</td>
        <td>${escapeHtml(w.arti || "")}</td>
        <td>${statusBadge(w.status)}</td>
        <td class="cell-muted">${escapeHtml(groupNames(w))}</td>
        <td><input type="checkbox" class="word-eligible-cb" ${checked ? "checked" : ""} /></td>
      </tr>`;
    })
    .join("");

  emptyStateEl.style.display = filtered.length ? "none" : "block";
  emptyStateEl.textContent = allWords.length ? "No words match." : "No words here yet.";
  resultCountEl.textContent = allWords.length ? `${filtered.length} of ${allWords.length}` : "";
}

wordRowsEl.addEventListener("change", async (e) => {
  const cb = e.target.closest(".word-eligible-cb");
  if (!cb) return;
  const tr = cb.closest("tr[data-id]");
  const word = allWords.find((w) => w.id === tr.dataset.id);
  if (!word) return;
  await setWordSelection({ key: word.id, deckIds: word.groupIds || [] }, cb.checked);
  await refreshStateCache();
  renderList();
});

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
