# Kotoba Bank — Product Spec & Roadmap

A Chrome extension for learning Japanese vocabulary **while you browse**: a personal word bank,
flashcards that pop up on the page you're reading, and (from v2) a reader that recognises your
words on any Japanese website.

This document is the source of truth for **what** each version does and **when it's done**.
Each version builds on the previous one and ships on its own.

| Version | Theme | Status |
|---|---|---|
| **v1** | Kotoba Bank — word bank + popup flashcards | ✅ Done |
| **v2** | Reader — highlight words you've collected on any web page | 🟡 Built, in testing (`feature/reader-highlight`) |
| **v3** | Furigana helper — hover any word for reading + meaning | ⬜ Next |
| **v4** | Sentence mining — add words from the web in one click | ⬜ Planned |
| **v5** | Polish — shortcuts, per-site rules, stats | ⬜ Planned |
| **Release** | Public release track (runs alongside v2–v3) | ⬜ Planned |

---

## Principles

1. **Your data stays yours.** Everything lives in the browser (IndexedDB + `chrome.storage.local`).
   No account, no server, no tracking. Backup = export JSON.
2. **Never break the page.** Content scripts render in Shadow DOM or via the CSS Custom Highlight
   API — the host page's DOM and layout are never modified.
3. **Learn from real content.** Every feature should shorten the loop
   *read → don't know → look up → save → review → recognise it next time.*
4. **Quiet by default.** Popups, highlights and hovers must be easy to ignore and easy to switch off.
5. **English UI.** All interface text is English. Word meanings are whatever the user writes.

## Non-goals

- Multi-device sync or a backend.
- A full SRS scheduler (FSRS/Anki). The lightweight weighted picker stays.
- Grammar explanations, translation of whole sentences, or machine translation.
- Mobile browsers.

---

## v1 — Kotoba Bank ✅

**Goal:** one place for every word you've met, with flashcards that interrupt you just enough.

### Features
- **Word bank** (IndexedDB `words`): kanji, reading, meaning, example, notes, collections,
  per-word review stats. Status derived from reviews: *New → Learning → Mastered* (3 in a row).
- **Collections**: a word can belong to many; rename, reorder (drag), delete (unlinks, never deletes words).
- **On-page flashcard**: shows on the active tab every N minutes. Classic (reveal → Know/Forgot) or
  Tiered (hint → 3 grades). Snooze, drag to place, tap a kanji for its readings.
- **Study tab**: focused session over all eligible words, both directions
  (Kanji → Meaning and Meaning → Kanji, tracked separately), undo, pause, session results.
- **Words tab**: search, filter by status/collection, bulk add to collection, toggle "in rotation".
- **Kanji tab**: every kanji across your words, on'yomi/kun'yomi (KANJIDIC2), your own meaning/notes.
- **Graph tab**: kanji ↔ word graph.
- **Toolbar popup**: totals, show a card now, quick-add a word.
- **Settings**: light/dark/system, 4 accent themes, card position, frequency.
- **Backup**: export/import JSON (import backs up first if it would overwrite).

### Hidden for now
- Google Sheets deck sync (Settings → Add deck / Sync all). Code is intact; UI hidden with `hidden`.

---

## v2 — Reader: highlight what you know 🟡

**Goal:** open any Japanese page and instantly see which words you've already collected.

### Requirements
- R2.1 Words from the bank are underlined on any page that contains Japanese text.
  Colour = status (indigo New, amber Learning, green Mastered).
- R2.2 **Exact** matches are solid; **similar forms** (probably conjugated) are dashed.
  Similar = the word's stem followed directly by hiragana (食べ|た → 食べる, 行|った → 行く).
- R2.3 Noise rules: longest match wins · only words containing kanji · a one-kanji word only
  matches when its neighbours aren't kanji (雨 in 雨が, not in 雨天) · per-word mute.
- R2.4 Hovering a highlight shows a card instantly: status, reading, meaning,
  "similar form" note when relevant, and *Don't highlight*.
- R2.5 Works on dynamic pages (infinite scroll, SPAs) and stays smooth on long pages.
- R2.6 Settings: on/off, which statuses, clear muted words. Changes apply without reloading the page.
- R2.7 The page DOM is never modified (CSS Custom Highlight API).

### Done when
- [x] Unit tests for the matcher pass (`node --test tests/*.test.js`).
- [x] `tests/reader-test.html` behaves as each section describes.
- [x] Hover card appears instantly and follows the cursor between words.
- [x] Words split by `<ruby>` (e.g. NHK News Easy) or other inline tags still match — readings in `<rt>` are ignored and never underlined.
- [ ] Verified on: NHK News Easy, Japanese Wikipedia, a news site, Twitter/X.

### Known limits
- Text inside iframes isn't scanned.
- A similar form is a hint, not a guarantee (生きる and 生まれる share 生).

---

## v3 — Furigana helper: hover any word ⬜

**Goal:** never get stuck on a kanji. Hover **any** word — collected or not — and see how it's
read and what it means.

### Requirements
- R3.1 **Dictionary**: JMdict (EDRDG, CC BY-SA 4.0), compacted to a `.json.gz`, downloaded once on
  first use from the project's GitHub Release, stored in IndexedDB. Settings shows size, version,
  download progress, and *Update / Remove*.
- R3.2 **Hover anywhere** on Japanese text: find the longest dictionary word starting at the
  cursor and show reading (furigana) + English meanings (top senses) + part of speech.
- R3.3 **Deinflection**: conjugated verbs/adjectives resolve to their dictionary form
  (行った → 行く, 食べられない → 食べる, 美しかった → 美しい) and the card says which form it was.
- R3.4 If the word is in the bank, the card shows **your** meaning and status first, dictionary second.
- R3.5 Kanji breakdown per character (on/kun from KANJIDIC2) inside the card.
- R3.6 Lookups are fast: < 30 ms per hover on a mid-range laptop; the dictionary never loads into
  the page itself (lookups go through the background service worker).
- R3.7 Without the dictionary downloaded, v2 behaviour is unchanged and the card offers the download.

### Done when
- [ ] Hovering 日本 on ja.wikipedia.org shows にほん / にっぽん + "Japan".
- [ ] Deinflection test table (≥ 40 forms) passes.
- [ ] Lookup timing measured and under budget.
- [ ] Attribution for JMdict and KANJIDIC2 shown in Settings → About and in the README.

---

## v4 — Sentence mining ⬜

**Goal:** turn "I didn't know that word" into a flashcard in one click.

### Requirements
- R4.1 **+ Add to Kotoba Bank** on the hover card. Kanji, reading and meaning pre-filled from the
  dictionary (meaning editable before saving — e.g. translate to your own language).
- R4.2 The **sentence** the word was found in is saved as the word's example, plus the page URL.
- R4.3 Pick collection(s) and "in rotation" inline; last-used collection is remembered.
- R4.4 Newly added words highlight on the current page immediately.
- R4.5 Duplicate handling matches the Add word form (merge / update prompt).

### Done when
- [ ] From hover to saved word in ≤ 2 clicks, without leaving the page.
- [ ] The saved example sentence is trimmed to one sentence (。！？ boundaries).

---

## v5 — Polish ⬜

- Keyboard shortcut to toggle the reader (`chrome.commands`).
- Per-site rules: always off on chosen sites; on only for Japanese pages.
- Quick toggle in the toolbar popup.
- Encounter stats: "seen on the web N times" per word, words met this week.
- Optional: highlight style (underline / background / dot).

---

## Release track ⬜

Runs alongside v2–v3; the first public release is **v1 + v2** (v3 can follow as an update).

- [ ] Merge the current line (`2.0-Kotoba-Bank`) into `master`.
- [ ] English `README.md`: what it is, screenshots/GIF, install, privacy, credits.
- [ ] `LICENSE` for the code + data attribution (KANJIDIC2 / JMdict, CC BY-SA 4.0).
- [ ] Versioning: `manifest.json` version = git tag (`v1.0.0`), changelog in each GitHub Release.
- [ ] Packaging script: zip only the files the extension needs (no tests/docs/dev files).
- [ ] GitHub Release with the zip + install steps (Load unpacked).
- [ ] Landing page (GitHub Pages from `/docs`): hero, feature sections per version, install, privacy.
- [ ] Chrome Web Store listing (optional): screenshots, privacy policy page, permission justification
      for `<all_urls>` (needed for the on-page flashcard and the reader).
