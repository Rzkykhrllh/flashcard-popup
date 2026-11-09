/*
 * reader.js — highlights Kotoba Bank words on any web page, and shows a small
 * card when you hover one.
 *
 * - Matching lives in core/reader-match.js (pure, unit-tested). This file is
 *   only DOM plumbing: walk text nodes, turn matches into Ranges, paint them,
 *   handle hover.
 * - Painting uses the CSS Custom Highlight API (CSS.highlights + ::highlight)
 *   so the page's DOM is never modified — no wrapper <span>s that could break
 *   a site's layout or scripts. The ::highlight rules go in via
 *   document.adoptedStyleSheets for the same reason (no <style> node).
 * - Does nothing at all until a text node with Japanese in it shows up, and
 *   only then asks background.js for the bank ("getReaderIndex").
 */
(() => {
  if (window.__kotobaReaderLoaded) return;
  window.__kotobaReaderLoaded = true;
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return; // Chrome < 105

  const STATUSES = ["new", "learning", "mastered"];
  const HL_NAMES = STATUSES.flatMap((s) => [`kb-${s}`, `kb-${s}-v`]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TEMPLATE", "SVG", "CANVAS", "IFRAME"]);
  const HOVER_SHOW_MS = 0;   // instant — the card follows the cursor in real time
  const HOVER_HIDE_MS = 280;

  let settings = null;
  let index = null;
  let indexSig = "";
  let loading = null;          // in-flight getReaderIndex promise
  let active = false;          // highlighting currently on
  const highlights = new Map(); // name -> Highlight
  let nodeMatches = new Map();  // Text node -> [{ start, end, kind, word, range, hl }]

  /* ------------------------------ messaging ------------------------------ */

  function send(message) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(message, (r) => { void chrome.runtime.lastError; resolve(r); }); }
      catch (_) { resolve(null); } // extension reloaded — this content script is orphaned
    });
  }

  async function loadIndex() {
    if (loading) return loading;
    loading = (async () => {
      const res = await send({ type: "getReaderIndex" });
      loading = null;
      if (!res || !res.settings) return false;
      settings = res.settings;
      const statuses = new Set(settings.readerStatuses || STATUSES);
      const words = (res.words || []).filter((w) => statuses.has(w.status || "new"));
      const sig = JSON.stringify([settings.readerHighlight, [...statuses], settings.readerIgnore, words.map((w) => [w.id, w.kanji, w.status, w.hiragana, w.arti])]);
      const changed = sig !== indexSig;
      indexSig = sig;
      index = readerBuildIndex(words, settings.readerIgnore || []);
      return changed;
    })();
    return loading;
  }

  /* ------------------------------- painting ------------------------------ */

  function ensureStyles() {
    if (ensureStyles.done) return;
    ensureStyles.done = true;
    // Fixed status hues (same meaning as Kotoba Bank's badges). Kept mid-
    // saturation so they read on both light and dark sites.
    const C = { new: "99, 102, 241", learning: "245, 158, 11", mastered: "34, 197, 94" };
    let css = "";
    for (const s of STATUSES) {
      css += `::highlight(kb-${s}) { background-color: rgba(${C[s]}, .16); text-decoration: underline 2px rgb(${C[s]}); text-underline-offset: 3px; }\n`;
      css += `::highlight(kb-${s}-v) { text-decoration: underline 2px dashed rgb(${C[s]}); text-underline-offset: 3px; }\n`;
    }
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (_) {
      const style = document.createElement("style");
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function hl(name) {
    let h = highlights.get(name);
    if (!h) { h = new Highlight(); highlights.set(name, h); CSS.highlights.set(name, h); }
    return h;
  }

  function clearAll() {
    for (const name of HL_NAMES) { CSS.highlights.delete(name); }
    highlights.clear();
    nodeMatches = new Map();
  }

  function unpaintNode(node) {
    const prev = nodeMatches.get(node);
    if (!prev) return;
    for (const m of prev) m.hl.delete(m.range);
    nodeMatches.delete(node);
  }

  function paintNode(node) {
    unpaintNode(node);
    const text = node.data;
    if (!readerHasJapanese(text)) return;
    const matches = readerFindMatches(text, index);
    if (!matches.length) return;
    const list = [];
    for (const m of matches) {
      const range = new Range();
      range.setStart(node, m.start);
      range.setEnd(node, m.end);
      const h = hl(`kb-${m.word.status || "new"}${m.kind === "variant" ? "-v" : ""}`);
      h.add(range);
      list.push({ ...m, range, hl: h });
    }
    nodeMatches.set(node, list);
  }

  function acceptNode(node) {
    const p = node.parentElement;
    if (!p) return false;
    if (SKIP_TAGS.has(p.tagName.toUpperCase())) return false;
    if (p.closest("[contenteditable=''], [contenteditable='true'], textarea, input")) return false;
    return true;
  }

  function collectTextNodes(root, out) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (readerHasJapanese(root.data) && acceptNode(root)) out.push(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (readerHasJapanese(n.data) && acceptNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
  }

  // Paint in idle-time batches so a long page never blocks scrolling/typing.
  let queue = [];
  let scheduled = false;
  function enqueue(nodes) {
    if (!nodes.length) return;
    queue.push(...nodes);
    if (scheduled) return;
    scheduled = true;
    // timeout: rIC alone can be starved forever on a page that never goes
    // idle (constant animations), which would leave new content unpainted.
    const idle = window.requestIdleCallback
      ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
      : (cb) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: true }), 16);
    const run = (deadline) => {
      let n = 0;
      // When forced by the timeout there's no idle budget — do a fixed slice.
      const budget = deadline.didTimeout ? 150 : Infinity;
      while (queue.length && n < budget && (deadline.timeRemaining() > 2 || n < 50)) {
        const node = queue.shift();
        if (node.isConnected) paintNode(node);
        n++;
      }
      if (queue.length) idle(run); else scheduled = false;
    };
    idle(run);
  }

  async function fullScan() {
    if (!document.body) return;
    const nodes = [];
    collectTextNodes(document.body, nodes);
    if (!nodes.length) return; // no Japanese yet — stay dormant
    if (!index) await loadIndex();
    if (!settings || settings.readerHighlight === false) { stop(); return; }
    active = true;
    ensureStyles();
    clearAll();
    queue = [];
    enqueue(nodes);
  }

  function stop() {
    active = false;
    queue = [];
    clearAll();
    hideCard(true);
  }

  /* ------------------------------ live pages ----------------------------- */

  let pendingRoots = new Set();
  let mutTimer = null;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") pendingRoots.add(r.target);
      else for (const n of r.addedNodes) pendingRoots.add(n);
    }
    clearTimeout(mutTimer);
    mutTimer = setTimeout(async () => {
      const roots = [...pendingRoots];
      pendingRoots = new Set();
      const nodes = [];
      for (const root of roots) if (root.isConnected) collectTextNodes(root, nodes);
      if (!nodes.length) return;
      if (!active) { // first Japanese text on a page that had none at load
        if (settings && settings.readerHighlight === false) return;
        return fullScan();
      }
      enqueue(nodes);
    }, 350);
  });

  // The bank may have changed in another tab (word added, status moved up
  // after a review) — re-check whenever this tab comes back into view.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !index) return;
    if (await loadIndex()) fullScan();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    if (await loadIndex()) {
      if (settings.readerHighlight === false) stop(); else fullScan();
    }
  });

  /* -------------------------------- hover -------------------------------- */

  let host = null, shadow = null, cardEl = null;
  let shownMatch = null, showTimer = null, hideTimer = null;
  let overCard = false;

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  function matchAt(x, y) {
    const c = caretAt(x, y);
    if (!c || c.node.nodeType !== Node.TEXT_NODE) return null;
    const list = nodeMatches.get(c.node);
    if (!list) return null;
    for (const m of list) {
      if (c.offset < m.start || c.offset > m.end) continue;
      // caret offsets snap to the nearest gap, so confirm the pointer is
      // really over the word's glyphs, not just beside it.
      for (const rect of m.range.getClientRects()) {
        if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) return m;
      }
    }
    return null;
  }

  let rafPending = false, lastX = 0, lastY = 0;
  document.addEventListener("mousemove", (e) => {
    if (!active) return;
    lastX = e.clientX; lastY = e.clientY;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (overCard) return;
      const m = matchAt(lastX, lastY);
      if (m) {
        clearTimeout(hideTimer);
        if (shownMatch && shownMatch.range === m.range) return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => showCard(m), HOVER_SHOW_MS);
      } else {
        clearTimeout(showTimer);
        if (shownMatch) { clearTimeout(hideTimer); hideTimer = setTimeout(() => hideCard(), HOVER_HIDE_MS); }
      }
    });
  }, { passive: true });

  document.addEventListener("scroll", () => hideCard(true), { passive: true, capture: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCard(true); }, true);

  function themeVars() {
    const dark = settings.colorMode === "dark"
      || (settings.colorMode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const ACCENT = {
      blue: ["#2563eb", "#3b82f6"], red: ["#d34533", "#e06a55"],
      purple: ["#7c3aed", "#a78bfa"], green: ["#16a34a", "#4ade80"],
    }[settings.theme] || ["#2563eb", "#3b82f6"];
    return dark
      ? { bg: "#1b1a23", fg: "#eceaf3", muted: "#9d9aad", soft: "#262531", line: "rgba(255,255,255,.08)", accent: ACCENT[1], shadow: "0 18px 44px -12px rgba(0,0,0,.7)",
          new: ["rgba(129,140,248,.16)", "#c7d2fe"], learning: ["rgba(251,191,36,.14)", "#fcd34d"], mastered: ["rgba(52,211,153,.14)", "#6ee7b7"] }
      : { bg: "#ffffff", fg: "#1f1d2b", muted: "#696676", soft: "#f6f4f0", line: "rgba(31,29,43,.09)", accent: ACCENT[0], shadow: "0 18px 44px -14px rgba(31,29,43,.35)",
          new: ["#ecebfe", "#3f3cb5"], learning: ["#fdf1dc", "#8a4b06"], mastered: ["#e6f6ec", "#15693a"] };
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.id = "kotoba-reader-host";
    host.style.all = "initial";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    shadow.appendChild(style);
    cardEl = document.createElement("div");
    cardEl.className = "rc";
    shadow.appendChild(cardEl);
    cardEl.addEventListener("mouseenter", () => { overCard = true; clearTimeout(hideTimer); });
    cardEl.addEventListener("mouseleave", () => { overCard = false; hideTimer = setTimeout(() => hideCard(), HOVER_HIDE_MS); });
    document.documentElement.appendChild(host);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const STATUS_LABEL = { new: "New", learning: "Learning", mastered: "Mastered" };

  function showCard(m) {
    ensureHost();
    const t = themeVars();
    const st = m.word.status || "new";
    const [stBg, stFg] = t[st] || t.new;
    shadow.querySelector("style").textContent = `
      .rc { position: fixed; z-index: 2147483646; width: max-content; max-width: 280px; min-width: 180px;
        background: ${t.bg}; color: ${t.fg}; border: 1px solid ${t.line}; border-radius: 14px;
        box-shadow: ${t.shadow}; padding: 12px 14px 10px; display: none;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
        -webkit-font-smoothing: antialiased; animation: in .08s ease-out; }
      .rc.show { display: block; }
      @keyframes in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
      .top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .pill { font-size: 10px; font-weight: 700; letter-spacing: .03em; padding: 2px 8px; border-radius: 99px; background: ${stBg}; color: ${stFg}; }
      .tag { font-size: 10px; font-weight: 600; color: ${t.muted}; }
      .brand { margin-left: auto; font-size: 10px; color: ${t.muted}; }
      .reading { font-size: 13px; color: ${t.fg}; letter-spacing: .05em; }
      .word { font-family: "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; font-size: 24px; font-weight: 500; line-height: 1.25; }
      .arti { font-size: 14px; font-weight: 650; color: ${t.accent}; margin-top: 2px; }
      .similar { font-size: 11px; color: ${t.muted}; margin-top: 8px; padding: 6px 8px; border-radius: 8px; background: ${t.soft}; }
      .similar b { color: ${t.fg}; font-weight: 600; }
      .foot { display: flex; justify-content: flex-end; margin-top: 8px; }
      button.mute { border: 0; background: transparent; color: ${t.muted}; font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; padding: 3px 6px; border-radius: 6px; }
      button.mute:hover { background: ${t.soft}; color: ${t.fg}; }
    `;
    const w = m.word;
    const onPage = m.range.toString();
    cardEl.innerHTML = `
      <div class="top">
        <span class="pill">${STATUS_LABEL[st] || st}</span>
        ${m.kind === "variant" ? '<span class="tag">similar form</span>' : ""}
        <span class="brand">Kotoba Bank</span>
      </div>
      ${w.hiragana ? `<div class="reading">${esc(w.hiragana)}</div>` : ""}
      <div class="word">${esc(w.kanji)}</div>
      ${w.arti ? `<div class="arti">${esc(w.arti)}</div>` : ""}
      ${m.kind === "variant" ? `<div class="similar">On this page: <b>${esc(onPage)}</b> — maybe a form of <b>${esc(w.kanji)}</b>. Reading may differ.</div>` : ""}
      <div class="foot"><button class="mute" title="Stop highlighting this word everywhere">Don't highlight</button></div>
    `;
    cardEl.querySelector(".mute").addEventListener("click", async () => {
      hideCard(true);
      await send({ type: "readerIgnoreWord", id: w.id }); // storage.onChanged → rescan
    });

    cardEl.classList.add("show");
    shownMatch = m;
    position(m.range.getBoundingClientRect());
  }

  function position(r) {
    const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, r.left), vw - cw - 8);
    let top = r.bottom + 8;
    if (top + ch > vh - 8) top = Math.max(8, r.top - ch - 8);
    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${top}px`;
  }

  function hideCard(force) {
    clearTimeout(showTimer);
    if (!cardEl || (!force && overCard)) return;
    cardEl.classList.remove("show");
    shownMatch = null;
    overCard = false;
  }

  /* --------------------------------- boot -------------------------------- */

  function boot() {
    fullScan();
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
