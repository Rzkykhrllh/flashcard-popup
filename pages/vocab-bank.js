// vocab-bank.js — browse/filter view over the IndexedDB `words`/`groups` store.
// db.js is loaded first via <script>, exposing getAllWords/getAllGroups globally.

const GENERAL_GROUP = { id: "", name: "All (General)" };
const STATUS_LABEL = { new: "New", learning: "Learning", mastered: "Mastered" };

const statusTabsEl = document.getElementById("statusTabs");
const groupSelectEl = document.getElementById("groupSelect");
const wordRowsEl = document.getElementById("wordRows");
const emptyStateEl = document.getElementById("emptyState");
const resultCountEl = document.getElementById("resultCount");

let allWords = [];
let allGroups = [];
let activeStatus = "";
let activeGroupId = "";

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

function render() {
  const filtered = allWords.filter((w) => {
    if (activeStatus && w.status !== activeStatus) return false;
    if (activeGroupId && !(w.groupIds || []).includes(activeGroupId)) return false;
    return true;
  });

  wordRowsEl.innerHTML = filtered
    .map(
      (w) => `
      <tr>
        <td class="kanji-cell">${escapeHtml(w.kanji || "")}</td>
        <td class="reading-cell">${escapeHtml(w.hiragana || "")}</td>
        <td>${escapeHtml(w.arti || "")}</td>
        <td>${statusBadge(w.status)}</td>
        <td class="cell-muted">${escapeHtml(groupNames(w))}</td>
      </tr>`
    )
    .join("");

  emptyStateEl.style.display = filtered.length ? "none" : "block";
  resultCountEl.textContent = allWords.length ? `${filtered.length} of ${allWords.length}` : "";
}

statusTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".status-tab");
  if (!btn) return;
  activeStatus = btn.dataset.status;
  for (const b of statusTabsEl.querySelectorAll(".status-tab")) b.classList.toggle("active", b === btn);
  render();
});

groupSelectEl.addEventListener("change", () => {
  activeGroupId = groupSelectEl.value;
  render();
});

// Top-level tab switching (List / Graph). graph.js listens for "kotoba:data-ready"
// (dispatched below, once words/groups are loaded) and only starts its own layout
// once the Graph pane is actually visible — see startGraph() in graph.js.
document.querySelectorAll(".tab-nav .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-nav .tab-btn")) b.classList.toggle("active", b === btn);
    for (const pane of document.querySelectorAll(".tab-pane")) pane.classList.toggle("active", pane.id === `tab-${btn.dataset.tab}`);
    if (btn.dataset.tab === "graph" && typeof startGraph === "function") startGraph();
  });
});

async function init() {
  allWords = await getAllWords();
  allGroups = await getAllGroups();

  groupSelectEl.innerHTML = [GENERAL_GROUP, ...allGroups]
    .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
    .join("");

  updateCounts();
  render();

  document.dispatchEvent(new CustomEvent("kotoba:data-ready", { detail: { words: allWords, groups: allGroups } }));
}

init();
