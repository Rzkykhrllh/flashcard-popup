const send = (msg) => chrome.runtime.sendMessage(msg);

const cardCountEl = document.getElementById("cardCount");
const deckCountEl = document.getElementById("deckCount");
const syncStatusEl = document.getElementById("syncStatus");
const enabledStateEl = document.getElementById("enabledState");
const quizBtn = document.getElementById("quizBtn");
const syncBtn = document.getElementById("syncBtn");
const optionsBtn = document.getElementById("optionsBtn");

function timeAgo(ts) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function refresh() {
  const state = await send({ type: "getState" });
  const enabledDecks = state.decks.filter((d) => d.enabled !== false);
  const total = enabledDecks.reduce(
    (s, d) => s + Object.keys(state.cards[d.id] || {}).length,
    0
  );
  cardCountEl.textContent = total;
  deckCountEl.textContent = enabledDecks.length;

  const lastSynced = Math.max(0, ...state.decks.map((d) => d.lastSynced || 0));
  syncStatusEl.textContent = state.decks.length
    ? `Last sync: ${timeAgo(lastSynced)}.`
    : "No decks — add one in settings.";

  if (!state.settings.enabled) {
    enabledStateEl.textContent = "Popup is disabled.";
  } else if (Date.now() < (state.settings.snoozeUntil || 0)) {
    enabledStateEl.textContent = "Snoozed.";
  } else {
    enabledStateEl.textContent = `Shows every ~${state.settings.intervalMinutes} min.`;
  }
}

quizBtn.addEventListener("click", async () => {
  await send({ type: "showNow" });
  window.close(); // get out of the way so the card on the page is visible
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  const { results } = await send({ type: "syncAll" });
  const failed = (results || []).filter((r) => !r.ok);
  const added = (results || []).reduce((s, r) => s + (r.added || 0), 0);
  syncBtn.disabled = false;
  syncBtn.textContent = "Sync dari Google Sheet";
  if (!results || !results.length) {
    enabledStateEl.textContent = "No decks to sync.";
  } else if (failed.length) {
    enabledStateEl.textContent = `${failed.length} deck(s) failed — check settings.`;
  } else {
    enabledStateEl.textContent = added ? `+${added} new cards.` : "Up to date.";
  }
  refresh();
});

optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
