// graph.js — ego-centric kanji graph (next_feature.md §6.3), ported from
// kanji_explore.html ("Kanji" project). Physics/animation/visual style kept
// as-is; only the data layer changed: hardcoded KANJI/WORDS -> live IndexedDB
// `words`, and word-node coloring: tier (1/2) -> status (new/learning/mastered).
//
// Data arrives via the "kotoba:data-ready" event dispatched by vocab-bank.js
// once it has loaded words/groups from IndexedDB. Actual layout only starts
// once the Graph tab becomes visible (SVG needs a laid-out, non-zero size) —
// see startGraph(), called from options.js's switchTab().

const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;

let KANJI_SET = new Set();
let KANJI_GLOSS = {};
let WORDS = [];
let wordsWith = {};
let kanjisIn = (wd) => wd.kanjiList || [];
let deg = (k) => (wordsWith[k] || []).length;
let kSide = (k) => 44 + Math.min(deg(k) * 3, 18);

let dataReady = false;
let graphStarted = false;

function buildGraphData(words) {
  KANJI_SET = new Set();
  for (const w of words) for (const c of w.kanjiList || []) KANJI_SET.add(c);

  KANJI_GLOSS = {};
  for (const w of words) {
    if (w.kanji && [...w.kanji].length === 1 && KANJI_SET.has(w.kanji)) {
      KANJI_GLOSS[w.kanji] = w.arti || "";
    }
  }

  WORDS = words.map((w) => ({
    w: w.kanji, r: w.hiragana, m: w.arti, status: w.status || "new",
    id: w.id, kanjiList: w.kanjiList || [],
  }));

  wordsWith = {};
  WORDS.forEach((wd) => kanjisIn(wd).forEach((k) => { (wordsWith[k] = wordsWith[k] || []).push(wd); }));
}

document.addEventListener("kotoba:data-ready", (e) => {
  buildGraphData(e.detail.words);
  dataReady = true;
  const pane = document.getElementById("tab-graph");
  if (pane && pane.classList.contains("active")) startGraph();
});

function startGraph() {
  if (!dataReady) return; // will self-start once kotoba:data-ready fires while this tab is active
  if (graphStarted) { if (focusK) layout(); return; } // re-layout: pane was hidden (0-size) before
  if (!KANJI_SET.size) {
    detail.innerHTML = '<p class="meaning">No kanji to draw yet. Sync a deck or add some words first.</p>';
    return;
  }
  graphStarted = true;
  buildMap();
  const hub = [...KANJI_SET].sort((a, b) => deg(b) - deg(a))[0];
  setFocus(hub);
}

const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("svg");
const gE = document.createElementNS(NS, "g"), gN = document.createElementNS(NS, "g");
svg.append(gE, gN);

let view = new Map(), edges = [], edgeEls = [], focusK = null, trail = [], raf = 0, wsel = null;

function setFocus(k, fromCrumb) {
  if (!KANJI_SET.has(k)) return;
  focusK = k; wsel = null;
  if (!fromCrumb) { const i = trail.indexOf(k); trail = i >= 0 ? trail.slice(0, i + 1) : [...trail, k]; }
  layout(); drawCrumbs(); showKanji(k); updateMap();
}

function layout() {
  const W = svg.clientWidth, H = svg.clientHeight, cx = W / 2, cy = H / 2, maxR = Math.min(cx, cy) - 52;
  const words = wordsWith[focusK] || [], N = words.length;
  const Rw = Math.min(Math.max(118, 82 + N * 9), maxR * 0.6);
  const Rk = Math.min(Rw + 122, maxR);
  const tgt = new Map();
  tgt.set("k:" + focusK, { id: "k:" + focusK, type: "k", label: focusK, gloss: KANJI_GLOSS[focusK] || "", focus: true, tx: cx, ty: cy, wait: 0 });
  const wAng = {};
  words.forEach((wd, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(N, 1); wAng[wd.w] = a;
    tgt.set("w:" + wd.w, { id: "w:" + wd.w, type: "w", status: wd.status, label: wd.w, data: wd, tx: cx + Rw * Math.cos(a), ty: cy + Rw * Math.sin(a), wait: 2 + i * 1.4 });
  });
  words.forEach((wd, i) => {
    const comps = kanjisIn(wd).filter((c) => c !== focusK);
    comps.forEach((c, j) => {
      if (tgt.has("k:" + c)) return;
      const m = comps.length, off = (j - (m - 1) / 2) * 0.24, a = wAng[wd.w] + off;
      tgt.set("k:" + c, { id: "k:" + c, type: "k", label: c, gloss: KANJI_GLOSS[c] || "", tx: cx + Rk * Math.cos(a), ty: cy + Rk * Math.sin(a), wait: 5 + i * 1.4 });
    });
  });
  edges = [];
  words.forEach((wd) => {
    edges.push({ a: "k:" + focusK, b: "w:" + wd.w });
    kanjisIn(wd).forEach((c) => { if (c !== focusK) edges.push({ a: "w:" + wd.w, b: "k:" + c }); });
  });
  view.forEach((n) => { n.dead = true; n.tx = cx; n.ty = cy; n.wait = 0; });
  tgt.forEach((t, id) => {
    let n = view.get(id);
    if (n) { n.dead = false; Object.assign(n, { type: t.type, label: t.label, status: t.status, data: t.data, gloss: t.gloss, focus: !!t.focus, tx: t.tx, ty: t.ty, wait: 0 }); }
    else { view.set(id, { ...t, focus: !!t.focus, dead: false, x: cx, y: cy, op: 0, s: REDUCE ? 1 : 0.4, wait: REDUCE ? 0 : Math.round(t.wait || 0) }); }
  });
  syncDOM(); animate();
}

const elMap = new Map();
function makeEl(n) {
  const g = document.createElementNS(NS, "g"); g.setAttribute("class", "node");
  const wrap = document.createElementNS(NS, "g"); wrap.setAttribute("class", "tile-wrap");
  if (n.type === "k") {
    const S = kSide(n.label.slice(0, 1) || n.label);
    const r = document.createElementNS(NS, "rect"); r.setAttribute("class", "k-tile");
    r.setAttribute("width", S); r.setAttribute("height", S); r.setAttribute("x", -S / 2); r.setAttribute("y", -S / 2); r.setAttribute("rx", S * 0.28);
    const t = document.createElementNS(NS, "text"); t.setAttribute("class", "k-char"); t.setAttribute("font-size", S * 0.52); t.textContent = n.label;
    wrap.append(r, t); g.appendChild(wrap);
    g.addEventListener("click", () => { n.id.slice(2) !== focusK ? setFocus(n.id.slice(2)) : showKanji(focusK); });
  } else {
    const wl = [...n.label].length, w = wl * 19 + 18, h = 32;
    const r = document.createElementNS(NS, "rect"); r.setAttribute("class", "w-tile");
    r.setAttribute("width", w); r.setAttribute("height", h); r.setAttribute("x", -w / 2); r.setAttribute("y", -h / 2); r.setAttribute("rx", h / 2);
    const t = document.createElementNS(NS, "text"); t.setAttribute("class", "w-char"); t.setAttribute("font-size", "16"); t.textContent = n.label;
    wrap.append(r, t); g.appendChild(wrap);
    g.addEventListener("click", () => { wsel = n.id; showWord(n.data); syncClasses(); });
  }
  gN.appendChild(g); elMap.set(n.id, g); return g;
}
function syncDOM() {
  while (gE.firstChild) gE.removeChild(gE.firstChild);
  edgeEls = edges.map((e) => { const l = document.createElementNS(NS, "path"); l.setAttribute("class", "edge" + (e.a === "k:" + focusK ? " hot" : "")); gE.appendChild(l); return l; });
  view.forEach((n, id) => { if (!elMap.has(id)) makeEl(n); });
  syncClasses();
}
function syncClasses() {
  view.forEach((n, id) => {
    const el = elMap.get(id); if (!el) return;
    el.setAttribute("class", "node" + (n.type === "w" ? " w" + n.status : "") + (n.focus ? " focus" : "") +
      (n.type === "k" && !n.focus ? " nbk" : "") + (id === wsel ? " wsel" : ""));
  });
}
function draw() {
  edges.forEach((e, i) => {
    const a = view.get(e.a), b = view.get(e.b), l = edgeEls[i]; if (!l) return;
    if (!a || !b) { l.setAttribute("opacity", 0); return; }
    l.setAttribute("d", `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    l.setAttribute("opacity", Math.min(a.op, b.op).toFixed(2));
  });
  view.forEach((n, id) => {
    const el = elMap.get(id); if (!el) return;
    el.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)}) scale(${n.s.toFixed(3)})`);
    el.setAttribute("opacity", n.op.toFixed(2));
  });
}
function animate() { if (!raf) raf = requestAnimationFrame(step); }
function step() {
  raf = 0; let moving = false;
  view.forEach((n) => {
    if (n.wait > 0) { n.wait--; moving = true; return; }
    const k = REDUCE ? 1 : 0.18; n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k;
    const o = n.dead ? 0 : 1; n.op += (o - n.op) * (REDUCE ? 1 : 0.22);
    const ts = n.dead ? 0.4 : (n.focus ? 1.18 : 1); n.s += (ts - n.s) * (REDUCE ? 1 : 0.2);
    if (Math.abs(n.tx - n.x) + Math.abs(n.ty - n.y) > 0.5 || Math.abs(o - n.op) > 0.02 || Math.abs(ts - n.s) > 0.01) moving = true;
  });
  [...view.keys()].forEach((id) => { const n = view.get(id); if (n.dead && n.op < 0.04) { const el = elMap.get(id); if (el) { el.remove(); elMap.delete(id); } view.delete(id); } });
  draw(); if (moving) raf = requestAnimationFrame(step);
}

function drawCrumbs() {
  const c = document.getElementById("crumbs"); c.innerHTML = "";
  trail.forEach((k, i) => {
    if (i) c.insertAdjacentHTML("beforeend", `<span class="sep">›</span>`);
    const s = document.createElement("span"); s.className = "cb" + (k === focusK ? " now" : ""); s.textContent = k;
    s.onclick = () => setFocus(k, true); c.appendChild(s);
  });
}

const detail = document.getElementById("detail");
// Named distinctly from vocab-bank.js's own STATUS_LABEL — both scripts run in
// the same page's global scope (classic <script>, not modules), so identical
// top-level `const` names collide with a SyntaxError that silently kills the
// whole script.
const GRAPH_STATUS_LABEL = { new: "New", learning: "Learning", mastered: "Mastered" };

function showKanji(k) {
  const inW = wordsWith[k] || [];
  const rows = inW.map((wd) => {
    const html = [...wd.w].map((ch) => (ch === k ? `<em>${ch}</em>` : ch)).join("");
    return `<div class="wrow ${wd.status}" data-w="${escapeHtml(wd.w)}"><span class="w">${html}</span>
      <span class="r">${escapeHtml(wd.r || "")}</span><span class="m">${escapeHtml(wd.m || "")}</span></div>`;
  }).join("");
  const gloss = KANJI_GLOSS[k] || "no single-kanji meaning yet";
  detail.innerHTML = `<div class="card">
      <div class="lab">kanji</div>
      <div class="big k">${k}</div>
      <div class="meaning">${escapeHtml(gloss)}</div>
      <div class="stat">used in ${inW.length} word${inW.length === 1 ? "" : "s"}</div>
    </div>
    <div class="sub">words containing ${k}</div>
    <div class="wlist">${rows || '<p class="meaning">No other words use this kanji yet.</p>'}</div>`;
  detail.querySelectorAll(".wrow").forEach((r) => r.onclick = () => { wsel = "w:" + r.dataset.w; showWord(WORDS.find((x) => x.w === r.dataset.w)); syncClasses(); });
}
function showWord(wd) {
  const parts = [...wd.w].map((c) => (KANJI_SET.has(c)
    ? `<div class="part link" data-k="${c}"><span class="pk">${c}</span><span class="pm">${escapeHtml(KANJI_GLOSS[c] || "")}</span><span class="go">center here ›</span></div>`
    : `<div class="part dead"><span class="pk">${c}</span><span class="pm">kana</span></div>`)).join("");
  detail.innerHTML = `<div class="card">
      <div class="lab">word</div>
      <div class="big">${escapeHtml(wd.w)} <span class="read">${escapeHtml(wd.r || "")}</span></div>
      <div class="meaning">${escapeHtml(wd.m || "")}</div>
      <span class="badge ${wd.status}">${GRAPH_STATUS_LABEL[wd.status] || wd.status}</span>
    </div>
    <div class="sub">kanji parts</div><div class="parts">${parts}</div>`;
  detail.querySelectorAll(".part.link").forEach((p) => p.onclick = () => setFocus(p.dataset.k));
}

const sb = document.getElementById("search"), sug = document.getElementById("sug");
sb.addEventListener("input", () => {
  const q = sb.value.trim().toLowerCase(); if (!q) { sug.classList.remove("show"); return; }
  const ks = [...KANJI_SET].filter((k) => k.includes(q) || (KANJI_GLOSS[k] || "").toLowerCase().includes(q)).map((k) => ({ type: "k", k, label: k, m: KANJI_GLOSS[k] || "" }));
  const ws = WORDS.filter((w) => w.w.includes(q) || (w.r || "").includes(q) || (w.m || "").toLowerCase().includes(q)).map((w) => ({ type: "w", k: kanjisIn(w)[0], label: w.w, m: w.r }));
  const all = [...ks, ...ws].slice(0, 8);
  sug.innerHTML = all.map((x, i) => `<div data-i="${i}"><span class="sk">${escapeHtml(x.label)}</span><span class="sm">${escapeHtml(x.m || "")}</span></div>`).join("");
  sug.classList.toggle("show", all.length > 0);
  sug.querySelectorAll("div").forEach((d, i) => d.onclick = () => {
    const x = all[i]; if (x.k) {
      setFocus(x.k);
      if (x.type === "w") { const wd = WORDS.find((w) => w.w === x.label); wsel = "w:" + wd.w; showWord(wd); syncClasses(); }
    }
    sb.value = ""; sug.classList.remove("show");
  });
});
sb.addEventListener("blur", () => setTimeout(() => sug.classList.remove("show"), 150));

// ---------- minimap: layout frozen once (kanji<->kanji), no live simulation ----------
const MW = 176, MH = 146, MPAD = 15;
let mapPos = {}, mapLine = []; const mapDot = {};
function neighborsOf(k) { const s = new Set(); WORDS.forEach((wd) => { const cs = kanjisIn(wd); if (cs.includes(k)) cs.forEach((c) => { if (c !== k) s.add(c); }); }); return s; }
function computeMapLayout() {
  const ks = [...KANJI_SET], P = {};
  ks.forEach((k, i) => { P[k] = { x: Math.cos(i * 2.4) * 50, y: Math.sin(i * 2.4) * 50, vx: 0, vy: 0 }; });
  const E = [], seen = new Set();
  WORDS.forEach((wd) => {
    const cs = kanjisIn(wd);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j], key = a < b ? a + b : b + a;
      if (!seen.has(key)) { seen.add(key); E.push([a, b]); }
    }
  });
  for (let t = 0; t < 340; t++) {
    const al = 1 - t / 340;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = P[ks[i]], b = P[ks[j]];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = 150 / d2;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    E.forEach(([a, b]) => {
      const A = P[a], B = P[b]; let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, f = (d - 26) * 0.06;
      A.vx += dx / d * f; A.vy += dy / d * f; B.vx -= dx / d * f; B.vy -= dy / d * f;
    });
    ks.forEach((k) => { const p = P[k]; p.vx += -p.x * 0.02; p.vy += -p.y * 0.02; p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx * al; p.y += p.vy * al; });
  }
  return { P, E };
}
function buildMap() {
  const { P, E } = computeMapLayout();
  const xs = Object.values(P).map((p) => p.x), ys = Object.values(P).map((p) => p.y);
  const mnx = Math.min(...xs), mxx = Math.max(...xs), mny = Math.min(...ys), mxy = Math.max(...ys);
  const sx = (MW - 2 * MPAD) / ((mxx - mnx) || 1), sy = (MH - 2 * MPAD) / ((mxy - mny) || 1);
  Object.keys(P).forEach((k) => mapPos[k] = { x: MPAD + (P[k].x - mnx) * sx, y: MPAD + (P[k].y - mny) * sy });
  const msvg = document.getElementById("mapsvg"); msvg.setAttribute("viewBox", `0 0 ${MW} ${MH}`);
  const ge = document.createElementNS(NS, "g"), gd = document.createElementNS(NS, "g"); msvg.append(ge, gd);
  mapLine = E.map(([a, b]) => {
    const l = document.createElementNS(NS, "line"); l.setAttribute("class", "mm-edge");
    l.setAttribute("x1", mapPos[a].x); l.setAttribute("y1", mapPos[a].y); l.setAttribute("x2", mapPos[b].x); l.setAttribute("y2", mapPos[b].y);
    ge.appendChild(l); return { l, a, b };
  });
  Object.keys(mapPos).forEach((k) => {
    const c = document.createElementNS(NS, "circle"); c.setAttribute("class", "mm-dot");
    c.setAttribute("cx", mapPos[k].x); c.setAttribute("cy", mapPos[k].y); c.setAttribute("r", 3);
    const ti = document.createElementNS(NS, "title"); ti.textContent = k + " · " + (KANJI_GLOSS[k] || ""); c.appendChild(ti);
    c.addEventListener("click", () => setFocus(k)); mapDot[k] = c; gd.appendChild(c);
  });
}
function updateMap() {
  if (!Object.keys(mapDot).length) return;
  const nb = neighborsOf(focusK);
  Object.keys(mapDot).forEach((k) => {
    const c = mapDot[k];
    c.setAttribute("class", "mm-dot" + (k === focusK ? " foc" : nb.has(k) ? " nb" : ""));
    c.setAttribute("r", k === focusK ? 6 : nb.has(k) ? 4.2 : 3);
  });
  mapLine.forEach((o) => o.l.setAttribute("class", "mm-edge" + ((o.a === focusK || o.b === focusK) ? " hot" : "")));
}
document.getElementById("mtog").onclick = () => {
  const m = document.getElementById("minimap"); m.classList.toggle("collapsed");
  document.getElementById("mtog").textContent = m.classList.contains("collapsed") ? "▸" : "▾";
};

window.addEventListener("resize", () => { if (focusK) layout(); });

// ---------- fullscreen ----------
const graphWrap = document.querySelector("#tab-graph .wrap");
const fsToggle = document.getElementById("fsToggle");
fsToggle.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else graphWrap.requestFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  const isFs = document.fullscreenElement === graphWrap;
  fsToggle.textContent = isFs ? "⤢" : "⛶";
  fsToggle.title = isFs ? "Exit fullscreen" : "Fullscreen";
  if (focusK) layout(); // svg size changed — recompute node positions
});
