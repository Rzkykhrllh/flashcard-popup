(() => {
  if (window.__nihongoPopupLoaded) return;
  window.__nihongoPopupLoaded = true;

  let host = null;
  // render() awaits chrome.storage.local.get() before it ever assigns
  // `host` — so a second "showCard" arriving during that gap would also
  // pass the `if (host) return` guard below and start its own concurrent
  // render, leaving one card orphaned (out of sync with what close()/the
  // grade buttons operate on). This flag closes that gap synchronously.
  let rendering = false;
  let dragState = null; // shared across renders, registered once

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function send(message) {
    try { chrome.runtime.sendMessage(message); } catch (_) {}
  }

  function sendAsync(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => resolve(response));
      } catch (_) {
        resolve(null);
      }
    });
  }

  // Lazy, cached per page-load — same pattern as pages/word-editor.js's
  // loadKanjidic(), just fetched from the content-script world instead of
  // an extension page. Only loaded the first time a kanji card is opened.
  let kanjidicPromise = null;
  function loadKanjidic() {
    if (!kanjidicPromise) {
      kanjidicPromise = fetch(chrome.runtime.getURL("data/kanjidic.json")).then((r) => r.json());
    }
    return kanjidicPromise;
  }

  function close() {
    dragState = null;
    if (!host) return;
    const node = host;
    host = null;
    const card = node.shadowRoot && node.shadowRoot.querySelector(".card");
    if (card) {
      card.classList.add("leaving");
      setTimeout(() => node.remove(), 180);
    } else {
      node.remove();
    }
  }

  function positionWrap(wrap, pos) {
    const m = 20;
    wrap.style.left = wrap.style.top = wrap.style.right = wrap.style.bottom = "auto";
    if (pos && typeof pos.x === "number") {
      wrap.style.left = Math.max(0, Math.min(pos.x, window.innerWidth  - 340)) + "px";
      wrap.style.top  = Math.max(0, Math.min(pos.y, window.innerHeight - 240)) + "px";
    } else {
      switch ((pos && pos.preset) || "bottom-right") {
        case "top-left":    wrap.style.left   = m+"px"; wrap.style.top    = m+"px"; break;
        case "top-right":   wrap.style.right  = m+"px"; wrap.style.top    = m+"px"; break;
        case "bottom-left": wrap.style.left   = m+"px"; wrap.style.bottom = m+"px"; break;
        default:            wrap.style.right  = m+"px"; wrap.style.bottom = m+"px"; break;
      }
    }
  }

  // Global drag listeners — registered once for the lifetime of this content script.
  document.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const r  = dragState.wrap.getBoundingClientRect();
    const x  = Math.max(0, Math.min(dragState.wrapX + dx, window.innerWidth  - r.width));
    const y  = Math.max(0, Math.min(dragState.wrapY + dy, window.innerHeight - r.height));
    const w  = dragState.wrap;
    w.style.left = x + "px"; w.style.top = y + "px";
    w.style.right = "auto";  w.style.bottom = "auto";
  }, true);

  document.addEventListener("mouseup", (e) => {
    if (!dragState || e.button !== 0) return;
    dragState.topEl.classList.remove("dragging");
    const r = dragState.wrap.getBoundingClientRect();
    try { chrome.storage.local.set({ cardPosition: { x: r.left, y: r.top } }); } catch (_) {}
    dragState = null;
  }, true);

  async function render(card) {
    const { settings = {}, cardPosition } = await chrome.storage.local.get(["settings", "cardPosition"]);
    const showHiragana = settings.showHiragana !== false;
    const showFurigana = !!settings.showFurigana;
    const tiered = settings.cardMode === "tiered";

    // Per-theme accent colors (baked into CSS string at render time).
    // Each theme covers: button/seal color, meaning text, forgot button tints.
    const ACCENT = {
      blue:   { l:"#2563eb", arti:"#1d4ed8", fBg:"#dbeafe", fFg:"#1e40af",  dk:"#3b82f6", artiDk:"#93c5fd", fBgDk:"#1e3a8a", fFgDk:"#93c5fd"  },
      red:    { l:"#d34533", arti:"#b23a26", fBg:"#fee2e2", fFg:"#991b1b",  dk:"#e06a55", artiDk:"#fca5a5", fBgDk:"#7f1d1d", fFgDk:"#fca5a5"  },
      purple: { l:"#7c3aed", arti:"#6d28d9", fBg:"#ede9fe", fFg:"#4c1d95",  dk:"#a78bfa", artiDk:"#c4b5fd", fBgDk:"#2e1065", fFgDk:"#c4b5fd"  },
      green:  { l:"#16a34a", arti:"#15803d", fBg:"#dcfce7", fFg:"#166534",  dk:"#4ade80", artiDk:"#86efac", fBgDk:"#14532d", fFgDk:"#86efac"  },
    };
    const ac = ACCENT[settings.theme] || ACCENT.blue;

    // colorMode: "system" | "light" | "dark" (settings.colorMode) — manual
    // override of the OS preference, same as options.html/popup.html. No
    // @media(prefers-color-scheme) below: picked once here instead, since
    // this style block is rebuilt fresh on every card render anyway.
    const isDark = settings.colorMode === "dark"
      || (settings.colorMode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const neutral = isDark
      ? { bg:"#1e1e1e", fg:"#e8e8e8", muted:"#a6a6a6", reading:"#b0b0b0", notes:"#888",
          border:"rgba(255,255,255,.09)", revealBg:"#e8e8e8", revealFg:"#1e1e1e",
          shadow:"0 12px 40px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.2)", x:"#666" }
      : { bg:"#f7f7f6", fg:"#1c1c1c", muted:"#6b6b6b", reading:"#444", notes:"#666",
          border:"rgba(0,0,0,.09)", revealBg:"#1c1c1c", revealFg:"#f7f7f6",
          shadow:"0 12px 40px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.07)", x:"#aaa" };
    const accent = isDark
      ? { c: ac.dk, arti: ac.artiDk, fBg: ac.fBgDk, fFg: ac.fFgDk }
      : { c: ac.l, arti: ac.arti, fBg: ac.fBg, fFg: ac.fFg };

    host = document.createElement("div");
    host.id = "nihongo-popup-host";
    host.style.all = "initial";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      /* Neutral base. All accent-derived colors follow the selected theme. */
      :host {
        --bg:${neutral.bg}; --fg:${neutral.fg};
        --muted:${neutral.muted}; --reading:${neutral.reading}; --notes:${neutral.notes};
        --border:${neutral.border};
        --reveal-bg:${neutral.revealBg}; --reveal-fg:${neutral.revealFg};
        --shadow:${neutral.shadow};
        --x:${neutral.x};
        --accent:${accent.c}; --arti:${accent.arti};
        --forgot-bg:${accent.fBg}; --forgot-fg:${accent.fFg}; --known-bg:${ac.l};
      }

      /* ── layout ── */
      * { box-sizing:border-box; margin:0; padding:0; }
      .wrap {
        position:fixed; z-index:2147483647;
        font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",
          -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .card {
        width:320px; max-width:calc(100vw - 40px);
        background:var(--bg); color:var(--fg);
        border:1px solid var(--border); border-radius:16px;
        padding:18px 18px 16px; box-shadow:var(--shadow);
        animation:rise .22s cubic-bezier(.2,.8,.2,1);
      }
      .card.leaving { animation:sink .18s ease forwards; }
      @keyframes rise { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
      @keyframes sink { to{opacity:0;transform:translateY(10px)} }
      @media (prefers-reduced-motion:reduce) { .card,.card.leaving { animation:none } }

      .top {
        display:flex; align-items:center; justify-content:space-between;
        margin-bottom:12px; cursor:grab; user-select:none;
      }
      .top.dragging { cursor:grabbing; }
      .eyebrow {
        font-size:11px; letter-spacing:.08em; text-transform:uppercase;
        color:var(--muted); pointer-events:none;
      }
      .seal { display:inline-block; width:8px; height:8px; border-radius:2px; background:var(--accent); margin-right:7px; vertical-align:1px; }
      .x { border:0; background:transparent; color:var(--x); font-size:18px; line-height:1; cursor:pointer; padding:2px 4px; border-radius:6px; flex:none; }
      .x:hover { background:rgba(0,0,0,.06); color:#444; }
      .kanji { font-size:46px; font-weight:500; line-height:1.15; text-align:center; padding:10px 0 14px; word-break:break-word; display:flex; flex-direction:column; align-items:center; gap:4px; }
      .furigana { font-size:0.38em; font-weight:400; color:var(--muted); letter-spacing:0.06em; line-height:1; }
      .k-char { cursor:pointer; border-radius:6px; }
      .k-char:hover { background:rgba(128,128,128,.16); }
      .answer { display:none; border-top:1px dashed var(--border); padding-top:12px; text-align:center; }
      .answer.show { display:block; }
      .reading { font-size:18px; color:var(--reading); }
      .arti { font-size:17px; font-weight:500; color:var(--arti); margin-top:4px; }
      .notes { font-size:13px; color:var(--notes); margin-top:8px; line-height:1.5; }
      .actions { margin-top:14px; }
      button.act { width:100%; border:0; border-radius:10px; padding:11px; font-size:15px; font-weight:500; cursor:pointer; font-family:inherit; }
      .reveal { background:var(--reveal-bg); color:var(--reveal-fg); }
      .reveal:hover { opacity:.88; }
      .grade { display:none; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
      .grade.show { display:grid; }
      .grade-tiered.show { display:flex; flex-direction:column-reverse; gap:8px; }
      .forgot { background:var(--forgot-bg); color:var(--forgot-fg); }
      .forgot:hover { filter:brightness(.96); }
      .known  { background:var(--known-bg); color:#fff; }
      .known:hover { filter:brightness(.92); }
      .hint-known { background:transparent; border:1.5px solid var(--accent); color:var(--accent); }
      .hint-known:hover { background:var(--known-bg); color:#fff; }
      .hint-row { text-align:center; margin-bottom:8px; }
      button.hint-btn { width:auto; background:transparent; border:1px solid var(--border); color:var(--muted); font-size:13px; padding:5px 16px; border-radius:99px; }
      button.hint-btn:hover { background:rgba(128,128,128,.08); color:var(--fg); }
      .snooze { display:block; width:100%; text-align:center; background:transparent; border:0; color:var(--muted); font-size:12px; margin-top:12px; cursor:pointer; font-family:inherit; }
      .snooze:hover { color:#444; text-decoration:underline; }

      /* ── inline kanji view (swaps in over the flashcard, same card) ── */
      .kv-back { border:0; background:transparent; color:var(--muted); font-size:11px; letter-spacing:.02em; cursor:pointer; padding:2px 0; font-family:inherit; }
      .kv-back:hover { color:var(--fg); }
      .kv-char { font-size:40px; font-weight:500; text-align:center; padding:8px 0 12px; }
      .kv-label { font-size:11px; color:var(--muted); margin:10px 0 4px; text-transform:uppercase; letter-spacing:.06em; }
      .kv-readings-row { display:flex; flex-wrap:wrap; gap:5px; min-height:22px; }
      .kv-pill { display:inline-block; background:rgba(128,128,128,.14); color:var(--fg); font-size:12px; padding:3px 9px; border-radius:99px; }
      .kv-empty { font-size:12px; color:var(--muted); }
      .kv-meaning, .kv-notes {
        display:block; width:100%; border:1px solid var(--border); background:transparent; color:var(--fg);
        border-radius:8px; padding:7px 9px; font-size:13px; font-family:inherit; margin-top:4px; resize:vertical;
      }
      .kv-meaning:focus, .kv-notes:focus { outline:2px solid var(--accent); outline-offset:-1px; }
      .kv-save { width:auto; margin-top:8px; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:7px 14px; font-size:13px; font-weight:500; cursor:pointer; font-family:inherit; }
      .kv-save:hover { opacity:.9; }
      .kv-saved { font-size:11px; color:var(--muted); margin-left:8px; }
      .kv-related { display:flex; flex-direction:column; gap:2px; margin-top:6px; max-height:120px; overflow-y:auto; }
      .kv-row { display:flex; align-items:baseline; gap:6px; padding:5px 4px; border-radius:6px; font-size:13px; }
      .kv-row .kv-k { font-weight:500; }
      .kv-row .kv-r { color:var(--reading); font-size:11px; }
      .kv-row .kv-m { color:var(--notes); margin-left:auto; text-align:right; font-size:12px; }
      .kview-loading { font-size:12px; color:var(--muted); text-align:center; padding:20px 0; }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    positionWrap(wrap, cardPosition);

    wrap.innerHTML = `
      <div class="card" role="dialog" aria-label="Japanese flashcard">
        <div class="top">
          <span class="eyebrow"><span class="seal"></span>思い出して · what does it mean?</span>
          <button class="x" aria-label="Close">×</button>
        </div>
        <div class="fc">
          <div class="kanji"></div>
          ${tiered ? '<div class="hint-row"><button class="act hint-btn">Show hiragana</button></div>' : ""}
          <div class="answer">
            <div class="reading"></div>
            <div class="arti"></div>
            <div class="notes"></div>
          </div>
          <div class="actions">
            <button class="act reveal">Reveal answer</button>
            <div class="grade ${tiered ? "grade-tiered" : ""}">
              <button class="act forgot">Forgot</button>
              ${tiered ? '<button class="act hint-known">Know after hint</button>' : ""}
              <button class="act known">${tiered ? "Know kanji!" : "Known!"}</button>
            </div>
          </div>
          <button class="snooze">Snooze 30 min</button>
        </div>
        <div class="kview" style="display:none">
          <button class="kv-back">‹ Back to card</button>
          <div class="kv-char"></div>
          <div class="kv-label">On'yomi</div>
          <div class="kv-readings-row kv-on"></div>
          <div class="kv-label">Kun'yomi</div>
          <div class="kv-readings-row kv-kun"></div>
          <div class="kv-label">Your notes</div>
          <input class="kv-meaning" type="text" placeholder="Meaning / mnemonic" />
          <textarea class="kv-notes" rows="2" placeholder="Notes"></textarea>
          <button class="kv-save">Save<span class="kv-saved"></span></button>
          <div class="kv-label">Other words with this kanji</div>
          <div class="kv-related"></div>
        </div>
      </div>
    `;

    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    const $ = (s) => shadow.querySelector(s);

    // Wire the close button (and Escape) FIRST, before anything below that
    // could throw. If a future bug ever crashes mid-render again, the card
    // must still be closable instead of getting stuck on the page forever —
    // this is what actually broke here: extractKanjiList() came back
    // undefined on tabs where core/kanji.js hadn't loaded yet, so
    // appendKanjiText() below threw and every listener after it (including
    // this close button) silently never got attached.
    $(".x").addEventListener("click", close);
    const onKey = (e) => {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey, true); }
    };
    document.addEventListener("keydown", onKey, true);

    // Wraps each kanji character (not kana/okurigana) in a clickable span so
    // tapping it opens the inline kanji view below — lets you look up an
    // unfamiliar kanji the moment you see it, without leaving the page.
    function appendKanjiText(container, text) {
      for (const ch of String(text || "")) {
        if (extractKanjiList(ch).length) {
          const span = document.createElement("span");
          span.className = "k-char";
          span.dataset.k = ch;
          span.textContent = ch;
          container.appendChild(span);
        } else {
          container.appendChild(document.createTextNode(ch));
        }
      }
    }

    // .kanji is a column flex container (furigana stacks above the word), so
    // every direct child becomes its own row — the word itself must go in as
    // ONE child, not one child per character, or each kanji character ends
    // up on its own line instead of flowing as a single line of text.
    const kanjiEl = $(".kanji");
    const kanjiTextEl = document.createElement("span");
    kanjiTextEl.className = "kanji-text";
    if (!tiered && showFurigana && card.hiragana) {
      const furi = document.createElement("span");
      furi.className = "furigana";
      furi.textContent = card.hiragana;
      kanjiEl.appendChild(furi);
    }
    appendKanjiText(kanjiTextEl, card.kanji);
    kanjiEl.appendChild(kanjiTextEl);
    kanjiEl.addEventListener("click", (e) => {
      const k = e.target.closest(".k-char");
      if (k) openKanjiView(k.dataset.k);
    });

    // Inline kanji view — swaps in over the flashcard within the same card
    // instead of opening a separate window, so grading state (revealed?
    // drag position, etc.) isn't disturbed by a quick lookup.
    const fcEl = $(".fc");
    const kviewEl = $(".kview");
    const kvMeaning = $(".kv-meaning");

    async function openKanjiView(k) {
      fcEl.style.display = "none";
      kviewEl.style.display = "block";
      kvMeaning.dataset.char = k;
      $(".kv-char").textContent = k;
      $(".kv-on").innerHTML = '<span class="kv-empty">Loading…</span>';
      $(".kv-kun").innerHTML = "";
      $(".kv-related").innerHTML = '<div class="kview-loading">Loading…</div>';
      kvMeaning.value = "";
      $(".kv-notes").value = "";
      $(".kv-saved").textContent = "";

      const [dict, info] = await Promise.all([
        loadKanjidic(),
        sendAsync({ type: "getKanjiInfo", char: k }),
      ]);

      // Bail if the user backed out (or opened a different kanji) while this
      // was in flight — dataset.char only ever reflects the latest request.
      if (kvMeaning.dataset.char !== k) return;

      const entry = dict[k];
      $(".kv-on").innerHTML = entry && entry.on && entry.on.length
        ? entry.on.map((r) => `<span class="kv-pill">${escapeHtml(r)}</span>`).join("")
        : '<span class="kv-empty">—</span>';
      $(".kv-kun").innerHTML = entry && entry.kun && entry.kun.length
        ? entry.kun.map((r) => `<span class="kv-pill">${escapeHtml(r)}</span>`).join("")
        : '<span class="kv-empty">—</span>';

      const meta = info && info.meta;
      kvMeaning.value = meta ? meta.meaning || "" : "";
      $(".kv-notes").value = meta ? meta.notes || "" : "";

      const words = (info && info.words) || [];
      $(".kv-related").innerHTML = words.length
        ? words.map((w) => `
            <div class="kv-row">
              <span class="kv-k">${escapeHtml(w.kanji)}</span>
              <span class="kv-r">${escapeHtml(w.hiragana || "")}</span>
              <span class="kv-m">${escapeHtml(w.arti || "")}</span>
            </div>`).join("")
        : '<p class="kv-empty">No other words yet.</p>';
    }

    $(".kv-back").addEventListener("click", () => {
      kviewEl.style.display = "none";
      fcEl.style.display = "block";
    });

    $(".kv-save").addEventListener("click", async () => {
      const k = kvMeaning.dataset.char;
      if (!k) return;
      await sendAsync({ type: "saveKanjiMeta", char: k, meaning: kvMeaning.value, notes: $(".kv-notes").value });
      $(".kv-saved").textContent = "Saved";
      setTimeout(() => { $(".kv-saved").textContent = ""; }, 1200);
    });

    const readingEl = $(".reading");
    readingEl.textContent = card.hiragana || "";
    if (!showHiragana || !card.hiragana) readingEl.style.display = "none";

    $(".arti").textContent = card.arti || "";
    const notesEl = $(".notes");
    if (card.notes) notesEl.textContent = card.notes;
    else notesEl.style.display = "none";

    const answer = $(".answer");
    const reveal = $(".reveal");
    const grade  = $(".grade");

    if (tiered && card.hiragana) {
      $(".hint-btn").addEventListener("click", () => {
        const hint = document.createElement("div");
        hint.className = "furigana";
        hint.style.cssText = "font-size:.42em;color:var(--muted);margin-top:6px;letter-spacing:.05em";
        hint.textContent = card.hiragana;
        kanjiEl.appendChild(hint);
        $(".hint-row").style.display = "none";
      });
    } else if (tiered) {
      $(".hint-row").style.display = "none";
    }

    reveal.addEventListener("click", () => {
      answer.classList.add("show");
      reveal.style.display = "none";
      grade.classList.add("show");
    });

    function gradeAndClose(result) {
      send({ type: "grade", deckId: card.deckId, key: card.key, result });
      close();
    }
    $(".known").addEventListener("click", () => gradeAndClose("known"));
    $(".forgot").addEventListener("click", () => gradeAndClose("forgot"));
    $(".hint-known")?.addEventListener("click", () => gradeAndClose("hint"));
    $(".snooze").addEventListener("click", () => {
      send({ type: "snooze", minutes: 30 });
      close();
    });

    // Drag — mousedown starts state; mousemove/mouseup are on document (registered above)
    const topEl = $(".top");
    topEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      dragState = { startX: e.clientX, startY: e.clientY, wrapX: r.left, wrapY: r.top, wrap, topEl };
      topEl.classList.add("dragging");
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "closeCard") { close(); return; }
    if (msg.type !== "showCard") return;
    if (host || rendering) return;
    rendering = true;
    render(msg.card)
      .catch((e) => console.error("[nihongo-popup] render failed:", e))
      .finally(() => { rendering = false; });
  });
})();
