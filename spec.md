# Spec: replace popup toolbar stats ("cards" / "decks")

Status: **idea/brainstorm only — nothing implemented yet.** Written 2026-08-17.

## Why change it

The popup toolbar (`pages/popup.html` + `popup.js`) currently shows two numbers:

```
[ cards ]   [ decks ]
Last sync: N days ago.
```

Computed in `popup.js`'s `refresh()`:

```js
const enabledDecks = state.decks.filter((d) => d.enabled !== false);
const total = enabledDecks.reduce(
  (s, d) => s + Object.keys(state.cards[d.id] || {}).length,
  0
);
cardCountEl.textContent = total;
deckCountEl.textContent = enabledDecks.length;
```

Two problems with this today:

- `state.decks` only tracks **synced Google Sheet decks** (`chrome.storage.local.decks` — url/enabled/lastSynced). Manual collections (created via "New collection" when adding a word by hand) never appear in `state.decks`, so their words are invisible to this count entirely.
- Both numbers are gated on `enabled !== false`. If a synced deck's sync toggle is off (as happened this week — see the earlier "0 cards 0 decks" question), the toolbar reads 0/0 even though the vocab bank is full of words. It conflates "is this deck's Google Sheet sync turned on" with "how many words do I actually have."

So the toolbar's headline numbers don't answer the question someone glancing at the popup actually has: *how much vocab do I have, and how much of it is actually in rotation right now.*

## What Airu wants instead

Three candidate numbers, in priority order:

1. **Total words in the DB** — every word in IndexedDB, period, regardless of which collection(s) it's in or sync status.
2. **Words currently checked/eligible for learning** — how many of those words are actually in the Study/popup rotation right now.
3. **Number of collections** — lower priority ("gak gitu penting"), nice-to-have context rather than a headline number.

## Data already available (no new plumbing needed)

- **Total words**: `getAllWords()` (`core/db.js`) returns every word in the store — use `.length` directly. Don't sum `state.cards[deckId]` across categories; a word can belong to multiple collections (`groupIds`), so that would double-count. `getAllWords().length` is the one honest total.
- **Eligible words**: the exact rule already exists and is duplicated in two places that must stay in sync — `core/srs.js`'s `pickCard` (on-page popup) and `options.js`'s `isWordEligible()` (Study tab / browse table):

  ```js
  // A word is eligible unless it's explicitly excluded (selection[deckId][key] === false)
  // in EVERY one of its collections. No entry yet = still eligible by default.
  function isWordEligible(state, entry) {
    return entry.deckIds.some((deckId) => {
      const sel = state.selection[deckId];
      return !(sel && sel[entry.key] === false);
    });
  }
  ```

  `popup.js` doesn't have this helper today (it's only in `options.js`). Would need either a small duplicate copy (matching how `popup.js` already keeps its own local `escapeHtml`, per the existing "separate script world" pattern) or, better, a new `getState()`-adjacent message like `getStats` computed once in `background.js` so the eligibility rule only has to live in one place going forward (currently duplicated in 2 files already — a 3rd copy is a bug waiting to happen if the rule ever changes).
- **Collection count**: `state.categories.length` — already the superset of synced + manual collections.
- **Bonus, not requested but sitting right there**: `word.status` (`new` / `learning` / `mastered`, from `deriveStatus()` in `core/srs.js`) — could support a future breakdown, e.g. "12 new · 30 learning · 8 mastered," if a status view ever becomes interesting on the toolbar.

## Layout ideas

**A — minimal swap, same two boxes.** Keep the existing two-stat-box layout, just repoint the numbers and relabel:

```
[ 150 ]      [ 42 ]
 words       learning
8 collections · manual + synced
```

Smallest diff from today's UI. Drops "decks" as a concept from the toolbar entirely — replaces it with "learning" (eligible count) and pushes collection count down into the small secondary line where "Last sync" used to live.

**B — ratio-first.** Single combined stat instead of two boxes:

```
42 / 150 words in rotation
[▓▓▓▓▓▓░░░░░░░░░░░░░░░░]
8 collections
```

Reads more like a progress indicator than a dashboard. Trade-off: loses the "total words" number as its own headline figure — someone has to read the ratio to get it back out, which might undersell how big the vocab bank actually is.

**C — three boxes.** Give collections its own (smaller/secondary-styled) box instead of folding it into a text line:

```
[ 150 ]   [ 42 ]   [ 8 ]
 words    learning  lists
```

Most literal match to "3 numbers," but risks visual clutter in a small popup, and reintroduces exactly the "3 competing numbers" feel Airu flagged collection-count as not caring much about.

## Open questions for Airu

- Does "words currently dicentang buat learning" mean exactly `isWordEligible` (same rule the Study queue and the flashcard popup already use), or something narrower — e.g. only words that have been graded at least once, or only words with `status !== "mastered"`? Worth confirming since "eligible for the popup to show" and "actively being learned" aren't quite the same idea (a `mastered` word can still be eligible and still show up).
- Keep the "Last sync: N days ago" line at all? It's only meaningful when at least one collection is synced from a Google Sheet — could hide it entirely when there are zero synced decks, instead of showing "No decks — add one in settings" (current fallback), since manual-only setups are clearly a normal, supported way to use the extension now.
- Layout preference — A, B, C, or something else? A is the safest/smallest change; B communicates "how much of my vocab is active" most directly; C is the most literal but busiest.
- Should the eligibility rule move into a single shared place (a `getStats` handler in `background.js`) now that a 3rd surface would otherwise duplicate it, or is copying the existing small `isWordEligible` snippet into `popup.js` (matching its existing "own local copies" pattern) good enough for now?

## My lean (flagged as opinion, not decided)

Option A: smallest change, keeps two clear headline numbers (words / learning), and demotes collection count to the secondary text line instead of competing for toolbar space — matches Airu's own "collection count gak gitu penting" framing. Would also fold the eligibility rule into a `getStats` background.js handler rather than a 3rd copy-pasted `isWordEligible`, since duplicating an "eligibility" rule a 3rd time is exactly the kind of thing that quietly drifts out of sync later.

No code touched for this pass — this file is the idea dump Airu asked for before deciding.

---

# Spec: Stats tab → Study word list, and live session stats in Study

Status: **discussion only — explicitly told not to execute yet.** Written 2026-08-17 (same day as above, separate topic — this one is about the options page tabs, not the toolbar popup).

Two related ideas from Airu, both about surfacing stats in fewer/better places instead of spreading them across tabs.

## Idea 1 — fold the "Stats" tab into Study's word list

> "stats mending dipindah ke halaman study deh, isi list keduanya gak beda2 banget, jadi mending isi stat dipindah ke lis di study"

### Current state (read directly from the code, not guessed)

There's a dedicated **Stats** tab (`tab-stats` in `options.html`, `renderStats()` in `options.js`) that, per category, renders a full table:

```
Kanji | Reading | Meaning | Shown | Last seen | Know | Hint | Forgot | Ratio
```

grouped into one `<table>` per collection, with a category filter dropdown up top. All of it reads straight off `state.cards[deckId]` — the same per-word records (`seen`, `known`, `hint`, `forgot`, `lastSeen`, all already present via `wordToCard()`).

Study's own **"Word list"** browse table (`renderStudyBrowse()`, inside the collapsed `<details>` under the flashcard) renders a *different* table over the *same* underlying words:

```
In popup (switch) | Kanji | Reading | Meaning | Notes
```

So Airu's observation is accurate: two tables, two tabs, mostly the same rows (Kanji/Reading/Meaning repeated in both), pulling from the same `state.cards`/`entries` data — Stats adds performance columns, Study's browse adds the eligibility switch + Notes. Nothing today combines "toggle whether a word is in rotation" with "see how well I know it" in one place, even though that's arguably one coherent view: "here's my vocab, here's how I'm doing on it, here's what's active."

### Wrinkles to work out before touching code

- **Grouping model differs.** Stats groups by category — a separate table *per collection*, with a filter that narrows which collection(s) render. Study's browse table is one flat table across *all* categories at once, with Category as just one of several column filters (search / category / on-off). Merging means picking one model, not keeping both.
- **Table width.** Study's browse table already carries 5 columns inside a collapsed, intentionally-secondary panel — the previous UI pass explicitly trimmed this area to feel lightweight, not like a data grid. Bolting on Shown/Last seen/Know/Hint/Forgot/Ratio (5 more columns) risks turning it into exactly the dense spreadsheet-y table Study has been trending away from. Options: (a) add all columns and accept horizontal scroll, (b) collapse Know/Hint/Forgot into the one compact `Ratio` bar+% that Stats already has (drop the raw counts), (c) keep it a two-tier thing — Study's browse stays light, but a per-row "expand" or a small stat chip per row links out to detail instead of adding columns outright.
- **Does Stats tab disappear entirely, or shrink?** Full removal is the literal reading of "isi stat dipindah ke list di study," but worth confirming — e.g. does removing the tab affect anything else that links to it (need to grep for references before deleting the nav entry), and does Airu ever want the *full* sortable/detailed breakdown (all columns, per-collection sections) that a merged, space-constrained Study table probably can't fully replace?
- **Notes column** — currently only in Study's browse table, not in Stats. Would need to decide if it survives a merge or gets dropped to make room for stat columns.

### My lean (opinion, not decided)

Don't attempt a full one-shot merge — it's the riskiest option here (two grouping models to reconcile, real risk of re-bloating the exact panel we just minimalized, and a tab-removal to validate). Start smaller: add just the compact `Ratio` indicator (small bar + %, exactly like Stats already renders it) as one new column on Study's browse table — that alone answers "how am I doing on this word" without reintroducing 5 raw-count columns. Leave the Stats tab alone for now as the place for the full, sortable, per-collection breakdown. Revisit removing Stats entirely once we see whether the lightweight version inside Study actually replaces the need for it, rather than deleting a whole tab up front and finding out it's missed.

## Idea 2 — live running stats while actively studying

> "di study, tolong dong kasih liat current statistik? kaya udah berapa yg muncul, berapa yg know, dan berapa yg forget"

### Current state

`studyState.tally = { known, hint, forgot }` is already tracked live — incremented on every grade inside `gradeCurrent()` — but it's currently **only rendered on the "Session complete" screen** (the `.study-tally` pills: `Know N / Hint N / Forgot N / X% recalled`). During the actual card-by-card flow, none of it is visible; the only progress signal right now is the top progress bar and the `index+1 / total` counter in `.study-nav`.

So this is cheap: the data already exists and updates correctly session-wide (confirmed — `gradeCurrent()` increments `studyState.tally[result]` before every `advanceStudy()` call), it just isn't rendered anywhere until the very end. No new state, no new plumbing — purely a rendering addition to the active-card branch of `renderStudy()`.

### One thing to clarify first

"Berapa yg muncul" (how many have appeared) could mean two different numbers:
- **Position in queue** — `studyState.index + 1`, already shown via the `X / total` counter. This counts cards you've navigated past, including ones skipped without grading (the "Skip →" button when not yet revealed).
- **Graded so far** — `known + hint + forgot` (from `studyState.tally`), which only counts cards actually answered. These two numbers diverge the moment you use "Skip" or "Prev" without grading.

Worth confirming which one Airu means by "muncul" — likely just reusing the existing `X / total`, with Know/Forgot added alongside it, rather than a third distinct number.

### Design options for where it lives

- **A — small pills, reusing `.study-tally`/`.tally-pill` as-is.** Same compact component already built for the done screen, placed near the top of the active card (e.g. next to or below the progress bar): `Know 4 · Hint 1 · Forgot 2`. Zero new CSS, just relocate/duplicate the render call.
- **B — inline in the nav row**, next to the existing `X / total` text: `5 / 20 · 4✓ 1? 2✗` or similar shorthand — more compact than full pills, but a new, denser text format not used anywhere else yet.
- **C — fold into the progress bar itself** — e.g. segment the bar's fill by outcome color (green portion = known, amber = hint, muted = forgot) instead of a single solid color, with the raw numbers only on hover/as a tooltip. Most visual, least textual, but a bigger interaction/visual change than A or B and harder to read at a glance for exact counts.

### Tension worth flagging

The pass just shipped deliberately shrank the active-card view's always-visible text (shortcuts → kbd badges, locked notice → one line, paused screen → just a heading). Adding a new persistent stat readout pulls the other way — more always-on UI in the same view. That's not a reason not to do it (Airu asked for it right after that pass, presumably having thought about the trade-off), but it's worth being deliberate about density: Option A done compactly (small muted pills, not a big block) keeps it in the spirit of the minimalism pass; a bigger dashboard-style readout would undo it.

### My lean (opinion, not decided)

Option A — reuse the existing `.tally-pill` component (already styled, already color-coded consistently with Stats tab's Know/Hint/Forgot cells) and place it compactly near the progress bar in the active-card view, not just the done screen. Cheapest to build (data's already there), visually consistent with what Airu already approved for the done screen, and easy to make as small/muted as needed to not re-bloat the view.

## Open questions for Airu (both ideas)

- Idea 1: full merge (Stats tab goes away) or start with just a compact Ratio column added to Study's browse table, leaving Stats tab as-is for now?
- Idea 1: if merging, does Study's browse table switch to per-collection sections (matching Stats' grouping) or stay one flat filterable table?
- Idea 2: does "muncul" mean queue position (`X / total`, already shown) or graded-count (`known+hint+forgot`)? Or just show both?
- Idea 2: pill placement — near the progress bar (Option A), inline with the nav counter (Option B), or something else?

No code touched for this discussion — waiting on direction before implementing either idea.
