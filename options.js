const send = (msg) => chrome.runtime.sendMessage(msg);
const el   = (id)  => document.getElementById(id);

const deckName       = el("deckName");
const deckUrl        = el("deckUrl");
const addBtn         = el("addBtn");
const addStatus      = el("addStatus");
const syncAllBtn     = el("syncAllBtn");
const syncStatus     = el("syncStatus");
const deckList       = el("deckList");
const emptyDecks     = el("emptyDecks");
const intervalInput  = el("interval");
const enabledInput   = el("enabled");
const showHiragana   = el("showHiragana");
const showFurigana   = el("showFurigana");
const swatches       = document.querySelectorAll(".swatch");
const posButtons     = document.querySelectorAll(".pos-btn");

function timeAgo(ts) {
  if (!ts) return "not synced yet";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

function setStatus(node, text, kind) {
  node.textContent = text;
  node.className   = "status" + (kind ? " " + kind : "");
}

const THEME_COLORS = {
  blue:   { l: "#2563eb", d: "#1d4ed8" },
  red:    { l: "#d34533", d: "#b23a26" },
  purple: { l: "#7c3aed", d: "#6d28d9" },
  green:  { l: "#16a34a", d: "#15803d" },
};

function applyActiveTheme(theme) {
  swatches.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  const t = THEME_COLORS[theme] || THEME_COLORS.blue;
  document.documentElement.style.setProperty("--shu", t.l);
  document.documentElement.style.setProperty("--shu-d", t.d);
}

function applyActivePos(cardPosition) {
  // Show active preset. If position was custom-dragged (x,y), no button highlighted.
  const preset = cardPosition && cardPosition.preset
    ? cardPosition.preset
    : (!cardPosition || typeof cardPosition.x !== "number") ? "bottom-right" : null;
  posButtons.forEach(b => b.classList.toggle("active", b.dataset.pos === preset));
}

async function render() {
  const [state, { cardPosition }] = await Promise.all([
    send({ type: "getState" }),
    chrome.storage.local.get("cardPosition"),
  ]);

  intervalInput.value    = state.settings.intervalMinutes;
  enabledInput.checked   = !!state.settings.enabled;
  showHiragana.checked   = state.settings.showHiragana !== false;
  showFurigana.checked   = !!state.settings.showFurigana;
  applyActiveTheme(state.settings.theme || "blue");
  applyActivePos(cardPosition);

  deckList.innerHTML = "";
  emptyDecks.style.display = state.decks.length ? "none" : "block";

  for (const deck of state.decks) {
    const count = Object.keys(state.cards[deck.id] || {}).length;
    const li = document.createElement("li");
    li.className = "deck";
    li.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${deck.enabled !== false ? "checked" : ""} />
        <span class="slider"></span>
      </label>
      <div class="meta">
        <div class="name"></div>
        <div class="sub">${count} kartu · ${timeAgo(deck.lastSynced)}</div>
      </div>
      <button class="rm">Delete</button>
    `;
    li.querySelector(".name").textContent = deck.name;
    li.querySelector("input").addEventListener("change", async (e) => {
      await send({ type: "toggleDeck", deckId: deck.id, enabled: e.target.checked });
    });
    li.querySelector(".rm").addEventListener("click", async () => {
      if (!confirm(`Delete deck "${deck.name}"? Card progress will be lost.`)) return;
      await send({ type: "removeDeck", deckId: deck.id });
      render();
    });
    deckList.appendChild(li);
  }
}

addBtn.addEventListener("click", async () => {
  const url = deckUrl.value.trim();
  if (!url) { setStatus(addStatus, "Paste the Google Sheet tab URL first.", "err"); return; }
  addBtn.disabled = true;
  setStatus(addStatus, "Adding & syncing…", "");
  const res = await send({ type: "addDeck", name: deckName.value.trim() || "Deck", url });
  addBtn.disabled = false;
  if (!res.ok) { setStatus(addStatus, res.error || "Failed to add deck.", "err"); return; }
  if (res.syncError) {
    setStatus(addStatus, "Deck added, but sync failed: " + res.syncError, "err");
  } else {
    setStatus(addStatus, `Added — ${res.added} cards read.`, "ok");
    deckName.value = "";
    deckUrl.value  = "";
  }
  render();
});

syncAllBtn.addEventListener("click", async () => {
  syncAllBtn.disabled    = true;
  syncAllBtn.textContent = "Syncing…";
  const { results }      = await send({ type: "syncAll" });
  syncAllBtn.disabled    = false;
  syncAllBtn.textContent = "Sync all";
  const failed  = (results || []).filter((r) => !r.ok);
  const added   = (results || []).reduce((s, r) => s + (r.added   || 0), 0);
  const updated = (results || []).reduce((s, r) => s + (r.updated || 0), 0);
  if (!results || !results.length) {
    setStatus(syncStatus, "No decks yet.", "");
  } else if (failed.length) {
    setStatus(syncStatus, `${failed.length} deck(s) failed: ${failed.map((f) => f.name + " (" + f.error + ")").join("; ")}`, "err");
  } else {
    setStatus(syncStatus, `Done — ${added} new, ${updated} updated.`, "ok");
  }
  render();
});

intervalInput.addEventListener("change", async () => {
  let v = parseInt(intervalInput.value, 10);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 240) v = 240;
  intervalInput.value = v;
  await send({ type: "updateSettings", patch: { intervalMinutes: v } });
});

enabledInput.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { enabled: enabledInput.checked } })
);

showHiragana.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { showHiragana: showHiragana.checked } })
);

showFurigana.addEventListener("change", () =>
  send({ type: "updateSettings", patch: { showFurigana: showFurigana.checked } })
);

swatches.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await send({ type: "updateSettings", patch: { theme: btn.dataset.theme } });
    applyActiveTheme(btn.dataset.theme);
  });
});

posButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    chrome.storage.local.set({ cardPosition: { preset: btn.dataset.pos } });
    posButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

render();
