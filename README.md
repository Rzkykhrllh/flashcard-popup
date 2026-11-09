# Kotoba Bank

**Learn Japanese vocabulary while you browse.** A Chrome extension with a personal word bank,
flashcards that pop up on the page you're reading, and highlights for the words you've already
collected — on any Japanese website.

![Words you know, highlighted on a Japanese page](docs/screenshots/reader.png)

[**Download the latest release**](https://github.com/Rzkykhrllh/flashcard-popup/releases/latest) ·
[Website](https://rzkykhrllh.github.io/flashcard-popup/) ·
[Roadmap](docs/SPEC.md)

---

## Features

### Your word bank
- Every word in one place: kanji, reading, meaning, example sentence, notes.
- Organise words into collections — a word can live in several at once.
- Each word tracks its own progress: **New → Learning → Mastered**.
- Export / import JSON backups. Everything stays in your browser.

### Flashcards that find you
- Every few minutes a card appears on whatever page you're on: recall, reveal, grade.
- Classic or Tiered mode (with a reading hint), snooze, drag it anywhere.
- Tap a kanji on the card to see its on'yomi / kun'yomi.

### A focused Study tab
- Kanji → Meaning **and** Meaning → Kanji, tracked separately.
- Keyboard-first (`Space` flip · `1` `2` `3` grade · `←` `→` navigate), undo, pause, session results.

### Reader: see what you know on any page
- Words from your bank are underlined on Japanese pages, coloured by status.
- Conjugated forms are recognised as *similar* (食べた → 食べる, 行った → 行く).
- Hover a word for its reading and **your** meaning. Works with furigana (`<ruby>`) sites like NHK News Easy.
- Never touches the page's HTML (uses the CSS Custom Highlight API).

### Also
- Kanji tab with readings from KANJIDIC2 and your own notes, plus a kanji ↔ word graph.
- Light / dark / system, four accent colours.

| Study | Words | Toolbar |
|---|---|---|
| ![Study](docs/screenshots/study.png) | ![Words](docs/screenshots/words.png) | ![Popup](docs/screenshots/popup.png) |

## Install

Kotoba Bank isn't on the Chrome Web Store yet, so it's installed as an unpacked extension:

1. Download `kotoba-bank-vX.Y.Z.zip` from the [latest release](https://github.com/Rzkykhrllh/flashcard-popup/releases/latest) and unzip it somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the extension, then click it → **Open bank** to add your first words.

To update: download the new zip, replace the folder, and press ↻ on the extension card.
Your words are kept — they live in the browser, not in the folder. (Export a backup first anyway.)

## Privacy

No account, no server, no analytics. Your words, progress and settings are stored only in your
browser (IndexedDB and `chrome.storage.local`). The extension needs access to all sites so it can
show flashcards and highlights on the pages you visit; it reads page text locally and never sends
it anywhere. See the [privacy policy](https://rzkykhrllh.github.io/flashcard-popup/privacy.html).

## Roadmap

| Version | | Status |
|---|---|---|
| v1 | Kotoba Bank — word bank + pop-up flashcards | ✅ |
| v2 | Reader — highlight words you know | ✅ |
| v3 | Furigana helper — hover **any** word for reading + meaning | Next |
| v4 | Sentence mining — add words from the web in one click | Planned |

Details and acceptance criteria: [docs/SPEC.md](docs/SPEC.md).

## Development

No build step — it's plain JavaScript loaded straight by Chrome.

```sh
node --test tests/*.test.js     # unit tests (word matcher)
python3 -m http.server 8000     # then open http://localhost:8000/tests/reader-test.html
scripts/package.sh              # build dist/kotoba-bank-v<version>.zip from HEAD
```

| Path | |
|---|---|
| `background.js` | Service worker: storage, scheduling, messages |
| `content.js` | On-page flashcard (Shadow DOM) |
| `reader.js`, `core/reader-match.js` | Reader highlights + hover card, and the word matcher |
| `core/` | IndexedDB layer, SRS weighting, kanji helpers |
| `pages/` | Toolbar popup and the Kotoba Bank page |

## Credits & license

- Code: [MIT](LICENSE).
- Kanji readings: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) by the
  Electronic Dictionary Research and Development Group, used under
  [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html).
- Font: Zen Maru Gothic (SIL OFL 1.1). CSV parsing: Papa Parse (MIT).

Made by [dev.byairu.com](https://dev.byairu.com).
