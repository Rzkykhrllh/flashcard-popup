/*
 * content.js — draws the flashcard overlay on whatever page is open.
 *
 * It lives in a Shadow DOM so the host page's CSS can't touch it, and styles are
 * fully self-contained (this renders on arbitrary websites). It only acts when the
 * background service worker sends a {type:"showCard"} message.
 */

(() => {
  if (window.__nihongoPopupLoaded) return; // guard against double-injection
  window.__nihongoPopupLoaded = true;

  let host = null; // current overlay host element (null when nothing showing)

  function send(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      /* extension context might be gone after an update — ignore */
    }
  }

  function close() {
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

  function render(card) {
    host = document.createElement("div");
    host.id = "nihongo-popup-host";
    // keep the host itself out of the page's layout/flow
    host.style.all = "initial";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .wrap {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP",
          -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: 320px; max-width: calc(100vw - 40px);
        background: #f6f3ec; color: #26221c;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 16px; padding: 18px 18px 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.08);
        animation: rise .22s cubic-bezier(.2,.8,.2,1);
      }
      .card.leaving { animation: sink .18s ease forwards; }
      @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      @keyframes sink { to { opacity: 0; transform: translateY(10px); } }
      @media (prefers-reduced-motion: reduce) {
        .card, .card.leaving { animation: none; }
      }
      .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9a8f7d; }
      .seal { display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: #d34533; margin-right: 7px; vertical-align: 1px; }
      .x { border: 0; background: transparent; color: #b3a895; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
      .x:hover { background: rgba(0,0,0,0.05); color: #6b6253; }
      .kanji { font-size: 46px; font-weight: 500; line-height: 1.15; text-align: center; padding: 10px 0 14px; word-break: break-word; }
      .answer { display: none; border-top: 1px dashed rgba(0,0,0,0.14); padding-top: 12px; text-align: center; }
      .answer.show { display: block; }
      .reading { font-size: 18px; color: #4a4234; }
      .arti { font-size: 17px; font-weight: 500; color: #b23a26; margin-top: 4px; }
      .notes { font-size: 13px; color: #7c7264; margin-top: 8px; line-height: 1.5; }
      .actions { margin-top: 14px; }
      button.act { width: 100%; border: 0; border-radius: 10px; padding: 11px; font-size: 15px; font-weight: 500; cursor: pointer; font-family: inherit; }
      .reveal { background: #26221c; color: #f6f3ec; }
      .reveal:hover { background: #3a342b; }
      .grade { display: none; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
      .grade.show { display: grid; }
      .forgot { background: #efe7df; color: #8a3d2c; }
      .forgot:hover { background: #e7dbd1; }
      .known { background: #d34533; color: #fff; }
      .known:hover { background: #b93a2a; }
      .snooze { display: block; width: 100%; text-align: center; background: transparent; border: 0; color: #9a8f7d; font-size: 12px; margin-top: 12px; cursor: pointer; font-family: inherit; }
      .snooze:hover { color: #6b6253; text-decoration: underline; }
      @media (prefers-color-scheme: dark) {
        .card { background: #211f1b; color: #ece7dd; border-color: rgba(255,255,255,0.08); }
        .eyebrow, .snooze { color: #8b8170; }
        .reading { color: #cfc7b6; }
        .arti { color: #f0876f; }
        .notes { color: #9a9082; }
        .answer { border-top-color: rgba(255,255,255,0.14); }
        .reveal { background: #ece7dd; color: #211f1b; }
        .reveal:hover { background: #fff; }
        .forgot { background: #36302a; color: #f0a08c; }
        .known { background: #d34533; color: #fff; }
        .x:hover { background: rgba(255,255,255,0.08); }
      }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = `
      <div class="card" role="dialog" aria-label="Japanese flashcard">
        <div class="top">
          <span class="eyebrow"><span class="seal"></span>思い出して · what does it mean?</span>
          <button class="x" aria-label="Close">×</button>
        </div>
        <div class="kanji"></div>
        <div class="answer">
          <div class="reading"></div>
          <div class="arti"></div>
          <div class="notes"></div>
        </div>
        <div class="actions">
          <button class="act reveal">Reveal answer</button>
          <div class="grade">
            <button class="act forgot">Forgot</button>
            <button class="act known">Known!</button>
          </div>
        </div>
        <button class="snooze">Snooze 30 min</button>
      </div>
    `;

    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    const $ = (s) => shadow.querySelector(s);
    $(".kanji").textContent = card.kanji || "";
    $(".reading").textContent = card.hiragana || "";
    $(".arti").textContent = card.arti || "";
    const notesEl = $(".notes");
    if (card.notes) notesEl.textContent = card.notes;
    else notesEl.style.display = "none";

    const answer = $(".answer");
    const reveal = $(".reveal");
    const grade = $(".grade");

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
    $(".x").addEventListener("click", close);
    $(".snooze").addEventListener("click", () => {
      send({ type: "snooze", minutes: 30 });
      close();
    });

    // Esc closes
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "closeCard") {
      close();
      return;
    }
    if (msg.type !== "showCard") return;
    if (host) return; // already showing one — don't stack
    render(msg.card);
  });
})();
