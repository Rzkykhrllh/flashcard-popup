(() => {
  if (window.__nihongoPopupLoaded) return;
  window.__nihongoPopupLoaded = true;

  let host = null;
  let dragState = null; // shared across renders, registered once

  function send(message) {
    try { chrome.runtime.sendMessage(message); } catch (_) {}
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

    host = document.createElement("div");
    host.id = "nihongo-popup-host";
    host.style.all = "initial";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      /* Neutral base. All accent-derived colors follow the selected theme. */
      :host {
        --bg:#f7f7f6; --fg:#1c1c1c;
        --muted:#888; --reading:#444; --notes:#666;
        --border:rgba(0,0,0,.09);
        --reveal-bg:#1c1c1c; --reveal-fg:#f7f7f6;
        --shadow:0 12px 40px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.07);
        --x:#aaa;
        --accent:${ac.l}; --arti:${ac.arti};
        --forgot-bg:${ac.fBg}; --forgot-fg:${ac.fFg}; --known-bg:${ac.l};
      }
      @media (prefers-color-scheme:dark) {
        :host {
          --bg:#1e1e1e; --fg:#e8e8e8;
          --muted:#777; --reading:#b0b0b0; --notes:#888;
          --border:rgba(255,255,255,.09);
          --reveal-bg:#e8e8e8; --reveal-fg:#1e1e1e;
          --shadow:0 12px 40px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.2); --x:#666;
          --accent:${ac.dk}; --arti:${ac.artiDk};
          --forgot-bg:${ac.fBgDk}; --forgot-fg:${ac.fFgDk}; --known-bg:${ac.l};
        }
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
    `;

    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    const $ = (s) => shadow.querySelector(s);

    const kanjiEl = $(".kanji");
    if (!tiered && showFurigana && card.hiragana) {
      const furi = document.createElement("span");
      furi.className = "furigana";
      furi.textContent = card.hiragana;
      kanjiEl.appendChild(furi);
      kanjiEl.appendChild(document.createTextNode(card.kanji || ""));
    } else {
      kanjiEl.textContent = card.kanji || "";
    }

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
    $(".x").addEventListener("click", close);
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

    const onKey = (e) => {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey, true); }
    };
    document.addEventListener("keydown", onKey, true);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "closeCard") { close(); return; }
    if (msg.type !== "showCard") return;
    if (host) return;
    render(msg.card);
  });
})();
