# TODO — Kotoba Popup (MVP → v1)

Urutan sesuai `next_feature.md` §10, dipecah jadi checklist per file. Checkbox
dicentang manual tiap sub-task kelar.

## MVP

### Foundation

- [x] `db.js` — schema IndexedDB v1 (`words`, `groups`), open/upgrade, CRUD helpers
- [x] `kanji.js` — kanji extraction util (dipakai sync & manual add nanti)
- [x] Status derivation — `deriveStatus()` di `srs.js`, langsung dari `seen`/`n`
      (tidak perlu `reviewHistory` baru — lihat next_feature.md §4)
- [x] `migrate.js` — migrasi `chrome.storage.local` → IndexedDB, dengan collision
      handling (next_feature.md §7.1)
- [x] Wire migration trigger ke `background.js` (`onInstalled`), idempotent lewat
      flag `_migrated`, data lama tidak dihapus

### Sync path

- [x] `background.js` — `syncDeck` / `recordGrade` / `getState` baca-tulis IndexedDB
      `words`/`groups` langsung, bukan `storage.local.cards` lagi. `srs.js`
      (`pickCard`), `popup.js`, `options.js` **tidak disentuh** — `getState()` di
      `background.js` reshape IndexedDB balik ke bentuk `{[deckId]:{[cardKey]:card}}`
      yang mereka sudah harapkan, jadi blast radius-nya kekunci di 1 file.
  - `decks` (config sync: url/spreadsheetId/enabled/lastSynced) tetap di
    `chrome.storage.local` — cuma data kata & progress yang pindah.
  - **Kata sekarang beneran dibagi antar deck**: kalau 2 sheet sama-sama punya
    kata yang sama persis (kanji+hiragana), sync bakal link ke 1 record yang
    sama (`groupIds` union), bukan bikin duplikat per-deck kayak dulu.
  - **`removeDeck` sekarang unlink, bukan delete** — behavior berubah dari
    sebelumnya. Kata yang cuma ada di deck yang dihapus TETAP ada di bank
    (groupIds-nya kosong), gak ikut kehapus. Sesuai visi §1: kata gak boleh
    hilang cuma gara-gara deck-nya dicabut.
  - Migrasi ke live IndexedDB via `runLiveCutover()` (flag `_liveCutoverDone`,
    terpisah dari `_migrated`) — nangkep progress yang sempat numpuk di
    `storage.local` antara migrasi awal dan switch ini, sekali jalan doang.
  - Ditest lewat fake-IndexedDB smoke test (cross-deck sharing, status
    derivation, `statusOverride` protection, unlink-not-delete) — semua pass.
    **Belum ditest di Chrome beneran.**

### Vocab bank

- [x] `vocab-bank.html/js/css` — browse semua `words`, filter by `status`/`groupIds`
      (tab status + dropdown group, termasuk opsi virtual "All (General)"),
      plus search box. Sekarang **live** — status ke-update begitu direview di
      popup, gak lagi snapshot basi.
  - Entry point: tombol "Kotoba Bank" baru di `popup.html` toolbar
- [x] Kanji graph (ego-centric, 1-hop) — di-port dari `reference/kanji_explore.html`
      (project "Kanji"), jadi tab "Graph" di dalam `vocab-bank.html`. Fisika/animasi/
      visual style dipertahankan apa adanya; data source diganti ke IndexedDB `words`,
      pewarnaan node diganti dari tier(1/2) jadi `status` (new/learning/mastered).
      Fullscreen toggle pakai native Fullscreen API.
- [x] Export/import JSON (`words` + `groups`), dengan konfirmasi jumlah
      baru/ketimpa sebelum eksekusi

### Konsolidasi halaman (belum dikerjakan)

- [ ] Gabung `vocab-bank.html` (List+Graph) ke `options.html` jadi satu tab-nav:
      Settings | Study | Bank | Graph. Pensiunin tab Stats yang lama (List di
      Bank strict upgrade-nya — ada filter status/group/search yang Stats gak
      punya). Update entry point di popup jadi hash-link ke 1 halaman
      (`options.html#bank` dst), bukan 2 page terpisah.

## Housekeeping

- [x] Tidy foldering: `core/` (db.js, kanji.js, migrate.js, srs.js), `pages/`
      (semua HTML/JS/CSS UI + graph.js/css), `reference/` (kanji_explore.html asli).
      `manifest.json`, `background.js`, `content.js`, `lib/` tetap di root.
      Semua path silang (manifest, importScripts, chrome.runtime.getURL, script/link
      src) sudah diupdate & diverifikasi resolve ke file yang benar.

## Next Version (post-MVP)

- [ ] Quick-add kartu manual di popup toolbar
- [ ] UI assign/bikin group manual di vocab-bank (group manual, bukan cuma synced)
- [ ] Manual status override (tombol "mark as mastered" dkk, set `statusOverride: true`)
- [ ] Kolom tambahan: `example`, `tags`, `partOfSpeech` — field sudah dialokasikan
      di schema (next_feature.md §3), belum ada UI buat isi/edit
- [ ] `manifest.json` — permission `unlimitedStorage` kalau ternyata dibutuhkan
      setelah data tumbuh
