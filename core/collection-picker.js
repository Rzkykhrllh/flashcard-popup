// collection-picker.js — the "Collections" field used when adding or editing
// a word (toolbar quick-add and the Words tab's modal). One search box that
// filters your collections and, when nothing matches, offers to create one
// with that name. Selected collections are shown as chips and as filled
// (accent-coloured) rows, so it's obvious at a glance what's picked.
//
// Keyboard: type to filter · ↑/↓ move · Enter toggles the highlighted row
// (or creates the collection) · Backspace on an empty box removes the last
// chip. Styles live in pages/collection-picker.css.
//
//   const picker = createCollectionPicker(el, {
//     onCreate: async (name) => group,      // persist + return the new group
//     onRename: async (id, name) => {},     // persist a rename
//   });
//   picker.setGroups(groups); picker.setSelected(ids); picker.getSelected();

function createCollectionPicker(root, { onCreate, onRename, onChange } = {}) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  root.classList.add("cp");
  root.innerHTML = `
    <div class="cp-search">
      <svg class="cp-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input class="cp-input" type="text" placeholder="Search or create a collection" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="true" aria-autocomplete="list" />
      <span class="cp-count" aria-live="polite"></span>
    </div>
    <div class="cp-chips"></div>
    <div class="cp-list" role="listbox" aria-multiselectable="true"></div>`;

  const input = root.querySelector(".cp-input");
  const chipsEl = root.querySelector(".cp-chips");
  const listEl = root.querySelector(".cp-list");
  const countEl = root.querySelector(".cp-count");

  let groups = [];
  let selected = new Set();
  let active = 0;          // index into the rendered (filtered) rows
  let editingId = null;
  let busy = false;

  const query = () => input.value.trim();

  function rows() {
    const q = norm(query());
    const list = q ? groups.filter((g) => norm(g.name).includes(q)) : groups.slice();
    const exact = q && groups.some((g) => norm(g.name) === q);
    const out = list.map((g) => ({ kind: "group", g }));
    if (q && !exact) out.push({ kind: "create", name: query() });
    return out;
  }

  function highlight(name) {
    const q = norm(query());
    if (!q) return esc(name);
    const i = norm(name).indexOf(q);
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length));
  }

  function render() {
    const rs = rows();
    if (active >= rs.length) active = Math.max(0, rs.length - 1);

    const picked = groups.filter((g) => selected.has(g.id));
    chipsEl.innerHTML = picked.map((g) =>
      `<span class="cp-chip" data-id="${esc(g.id)}">${esc(g.name)}<button type="button" class="cp-chip-x" title="Remove" aria-label="Remove ${esc(g.name)}">×</button></span>`).join("");
    chipsEl.hidden = !picked.length;
    countEl.textContent = picked.length ? `${picked.length} selected` : "";

    if (!rs.length) {
      listEl.innerHTML = `<div class="cp-empty">${groups.length ? "No matches." : "No collections yet. Type a name above to create one."}</div>`;
      return;
    }
    listEl.innerHTML = rs.map((r, i) => {
      const act = i === active ? " is-active" : "";
      if (r.kind === "create") {
        return `<div class="cp-row cp-create${act}" role="option" data-i="${i}"><span class="cp-plus">＋</span><span class="cp-name">Create “<b>${esc(r.name)}</b>”</span><kbd>Enter</kbd></div>`;
      }
      const g = r.g, on = selected.has(g.id);
      if (g.id === editingId) {
        return `<div class="cp-row is-editing${on ? " is-on" : ""}" data-i="${i}" data-id="${esc(g.id)}">
          <span class="cp-box"></span>
          <input class="cp-rename" type="text" value="${esc(g.name)}" />
          <button type="button" class="cp-mini cp-rename-ok" title="Save">✓</button>
          <button type="button" class="cp-mini cp-rename-no" title="Cancel">✕</button></div>`;
      }
      return `<div class="cp-row${on ? " is-on" : ""}${act}" role="option" aria-selected="${on}" data-i="${i}" data-id="${esc(g.id)}">
        <span class="cp-box"></span><span class="cp-name">${highlight(g.name)}</span>
        <button type="button" class="cp-mini cp-edit" title="Rename" tabindex="-1">✎</button></div>`;
    }).join("");

    const ed = listEl.querySelector(".cp-rename");
    if (ed) { ed.focus(); ed.select(); }
    else listEl.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render(); onChange?.(api.getSelected());
  }

  async function create(name) {
    name = name.trim();
    if (!name || busy) return;
    const dupe = groups.find((g) => norm(g.name) === norm(name));
    if (dupe) { selected.add(dupe.id); input.value = ""; render(); return; }
    busy = true;
    try {
      const g = await onCreate(name);
      if (g) { groups.push(g); selected.add(g.id); }
    } finally { busy = false; }
    input.value = ""; active = 0; render(); onChange?.(api.getSelected());
    input.focus();
  }

  async function commitRename(id, name) {
    name = name.trim();
    const g = groups.find((x) => x.id === id);
    editingId = null;
    if (g && name && name !== g.name) { await onRename?.(id, name); g.name = name; }
    render(); input.focus();
  }

  function activate(i) {
    const r = rows()[i];
    if (!r) return;
    if (r.kind === "create") create(r.name);
    else toggle(r.g.id);
  }

  input.addEventListener("input", () => { active = 0; editingId = null; render(); });
  input.addEventListener("keydown", (e) => {
    const n = rows().length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) { active = (active + 1) % n; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) { active = (active - 1 + n) % n; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); if (n) activate(active); }
    else if (e.key === "Backspace" && !input.value && selected.size) {
      const last = groups.filter((g) => selected.has(g.id)).pop();
      if (last) toggle(last.id);
    }
  });

  listEl.addEventListener("mousedown", (e) => { if (!e.target.closest(".cp-rename")) e.preventDefault(); }); // keep focus in the search box
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".cp-row");
    if (!row) return;
    if (e.target.closest(".cp-edit")) { editingId = row.dataset.id; render(); return; }
    if (e.target.closest(".cp-rename-ok")) { commitRename(row.dataset.id, row.querySelector(".cp-rename").value); return; }
    if (e.target.closest(".cp-rename-no")) { editingId = null; render(); return; }
    if (row.classList.contains("is-editing")) return;
    active = +row.dataset.i;
    activate(active);
  });
  listEl.addEventListener("keydown", (e) => {
    const ed = e.target.closest(".cp-rename");
    if (!ed) return;
    const id = ed.closest(".cp-row").dataset.id;
    if (e.key === "Enter") { e.preventDefault(); commitRename(id, ed.value); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); editingId = null; render(); input.focus(); }
  });
  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".cp-chip");
    if (chip && e.target.closest(".cp-chip-x")) toggle(chip.dataset.id);
  });

  const api = {
    setGroups(list) { groups = list.slice(); selected = new Set([...selected].filter((id) => groups.some((g) => g.id === id))); render(); },
    setSelected(ids) { selected = new Set((ids || []).filter((id) => groups.some((g) => g.id === id))); render(); },
    getSelected() { return groups.filter((g) => selected.has(g.id)).map((g) => g.id); },
    reset() { input.value = ""; active = 0; editingId = null; render(); },
    focus() { input.focus(); },
  };
  render();
  return api;
}

if (typeof module !== "undefined") module.exports = { createCollectionPicker };
