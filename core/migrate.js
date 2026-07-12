// migrate.js — one-time migration from chrome.storage.local (decks/cards,
// nested per-deck) to the IndexedDB words+groups schema (next_feature.md §3, §7).
//
// Split in two:
//   - buildMigrationPlan: pure, no chrome/indexedDB — testable in isolation.
//   - runMigration: thin wrapper wiring the plan to chrome.storage.local + db.js.

const MIGRATION_FLAG_KEY = "_migrated";
const MIGRATION_REPORT_KEY = "_migrationReport";

// decks: [{ id, name, url, ... }]
// cardsByDeck: { [deckId]: { [cardKey]: { kanji, hiragana, arti, notes, seen, known,
//               hint, forgot, lastSeen, createdAt, n, easeFactor } } }
function buildMigrationPlan(decks, cardsByDeck) {
  const groups = decks.map((d) => ({
    id: d.id,
    name: d.name,
    type: "synced",
    sourceSheetUrl: d.url || null,
  }));

  const words = {}; // id -> word
  const collisions = [];

  for (const deck of decks) {
    const cards = cardsByDeck[deck.id] || {};
    for (const [key, card] of Object.entries(cards)) {
      const candidate = {
        id: key,
        kanji: card.kanji,
        hiragana: card.hiragana,
        arti: card.arti,
        notes: card.notes,
        kanjiList: extractKanjiList(card.kanji),
        seen: card.seen || 0,
        known: card.known || 0,
        hint: card.hint || 0,
        forgot: card.forgot || 0,
        lastSeen: card.lastSeen || 0,
        createdAt: card.createdAt || 0,
        n: card.n || 0,
        easeFactor: card.easeFactor || 2.5,
        source: "sheet",
        groupIds: [deck.id],
        statusOverride: false,
      };
      candidate.status = deriveStatus(candidate);

      const prior = words[key];
      if (!prior) {
        words[key] = candidate;
        continue;
      }

      // Collision: same word (kanji|hiragana) came from >1 deck. No timestamped
      // history to merge chronologically (§7.1), so keep the further-along
      // progress — higher n, tie-break higher seen — and union groupIds so the
      // word still shows up under every deck it came from.
      const candidateWins =
        candidate.n > prior.n || (candidate.n === prior.n && candidate.seen > prior.seen);
      const winner = candidateWins ? { ...candidate } : { ...prior };
      const loser = candidateWins ? prior : candidate;
      winner.groupIds = [...new Set([...prior.groupIds, ...candidate.groupIds])];

      collisions.push({
        id: key,
        groupIds: winner.groupIds,
        winnerN: winner.n,
        winnerSeen: winner.seen,
        loserN: loser.n,
        loserSeen: loser.seen,
        artiMismatch: prior.arti !== candidate.arti,
      });
      words[key] = winner;
    }
  }

  return { words: Object.values(words), groups, collisions };
}

async function runMigration() {
  const flagRes = await chrome.storage.local.get(MIGRATION_FLAG_KEY);
  if (flagRes[MIGRATION_FLAG_KEY]) return { skipped: true };

  const { decks, cards } = await chrome.storage.local.get(["decks", "cards"]);
  const plan = buildMigrationPlan(decks || [], cards || {});

  await putWords(plan.words);
  await putGroups(plan.groups);

  // Old chrome.storage.local data (decks/cards) is intentionally left in place —
  // safety net until the sync path is fully switched to IndexedDB (see TODO.md).
  await chrome.storage.local.set({
    [MIGRATION_FLAG_KEY]: true,
    [MIGRATION_REPORT_KEY]: {
      migratedAt: Date.now(),
      wordCount: plan.words.length,
      groupCount: plan.groups.length,
      collisions: plan.collisions,
    },
  });

  if (plan.collisions.length) {
    console.warn(
      `[migrate] ${plan.collisions.length} word collision(s) resolved — see chrome.storage.local['${MIGRATION_REPORT_KEY}']`,
      plan.collisions
    );
  }

  return { skipped: false, ...plan };
}

const LIVE_CUTOVER_FLAG_KEY = "_liveCutoverDone";

// Re-applies buildMigrationPlan once more, right before background.js switches
// syncDeck/recordGrade/pickCard over to reading/writing IndexedDB `words`
// directly instead of chrome.storage.local `cards`. Between the initial
// runMigration() and this switch, review progress may have kept accumulating
// through the old storage.local-based path — this catches it one last time so
// nothing recorded during that window gets silently dropped. Runs exactly
// once: after this, storage.local's `cards` is frozen/historical and
// background.js never reads it again, so re-running this later on a future
// extension update would wrongly roll IndexedDB back to this snapshot.
async function runLiveCutover() {
  const flagRes = await chrome.storage.local.get(LIVE_CUTOVER_FLAG_KEY);
  if (flagRes[LIVE_CUTOVER_FLAG_KEY]) return { skipped: true };

  const { decks, cards } = await chrome.storage.local.get(["decks", "cards"]);
  const plan = buildMigrationPlan(decks || [], cards || {});

  await putWords(plan.words);
  await putGroups(plan.groups);
  await chrome.storage.local.set({ [LIVE_CUTOVER_FLAG_KEY]: true });

  return { skipped: false, ...plan };
}
