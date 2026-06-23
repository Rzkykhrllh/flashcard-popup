// srs.js — card selection and SM-2 state update.
// Pure functions; all mutable state lives in background.js.

// Weight for weighted-random selection.
// Higher weight = more likely to appear this popup tick.
// No time locks — all cards always eligible.
function computeWeight(c) {
  if ((c.seen || 0) === 0) return 12;          // unseen: highest priority
  const n  = c.n  || 0;
  const ef = c.easeFactor || 2.5;
  // Drops as consecutive correct answers grow (higher n = well known = less frequent).
  // Rises as ease factor falls (more forgotten = harder = more frequent).
  return Math.max(1, Math.round((8 / (n + 1)) * (2.5 / ef)));
}

// Weighted-random pick across all enabled decks.
// lastShownKey ("deckId:cardKey") prevents an immediate back-to-back repeat.
// Returns { deckId, key, card } or null if no cards exist.
function pickCard(state, lastShownKey) {
  const pool = [];
  for (const deck of state.decks) {
    if (deck.enabled === false) continue;
    const cards = state.cards[deck.id] || {};
    for (const [key, c] of Object.entries(cards)) {
      pool.push({ deckId: deck.id, key, card: c, weight: computeWeight(c) });
    }
  }
  if (pool.length === 0) return null;

  let candidates = pool;
  if (pool.length > 1 && lastShownKey) {
    const without = pool.filter(p => `${p.deckId}:${p.key}` !== lastShownKey);
    if (without.length) candidates = without;
  }

  const total = candidates.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  for (const p of candidates) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return candidates[candidates.length - 1];
}

// Update SM-2 state after a grade.
// Returns only { n, easeFactor } — no dueAt, no time-based scheduling.
function applySM2(card, result) {
  let n  = card.n  || 0;
  let ef = card.easeFactor || 2.5;
  if (result === "known") {
    n += 1;
    // SM-2 EF formula at q=4: delta = 0.1 - 1*(0.08+0.02) = 0 → EF unchanged on correct recall
    const q = 4;
    ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  } else if (result === "hint") {
    n += 1;                        // streak continues — you knew it, just needed a nudge
    ef = Math.max(1.3, ef - 0.1); // small ease penalty so card stays slightly more frequent
  } else {
    n  = 0;
    ef = Math.max(1.3, ef - 0.2); // each forgot lowers ease; floor at 1.3
  }
  return { n, easeFactor: ef };
}
