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

### Sync path (belum dikerjakan)

- [ ] `background.js` — `syncDeck` / `recordGrade` / `pickCard` baca-tulis
      IndexedDB, bukan `storage.local` lagi
  - **Berisiko** — ini progress belajar asli user, wajib ditest hati-hati sebelum
    switch penuh. Sengaja dipisah dari kerjaan foundation di atas supaya alur
    yang sudah jalan sekarang tidak ikut kesenggol dulu.

### Vocab bank

- [x] `vocab-bank.html/js/css` — browse semua `words`, filter by `status`/`groupIds`
      (tab status + dropdown group, termasuk opsi virtual "All (General)")
  - Entry point: tombol "Kotoba Bank" baru di `popup.html` toolbar
  - **Snapshot, bukan live** — nampilin data hasil migrasi terakhir. `status`
    gak bakal ke-update dari review popup harian sampai "Sync path" (di atas)
    kelar dikerjakan.
- [x] Kanji graph (ego-centric, 1-hop) — di-port dari `reference/kanji_explore.html`
      (project "Kanji"), jadi tab "Graph" di dalam `vocab-bank.html`. Fisika/animasi/
      visual style dipertahankan apa adanya; data source diganti ke IndexedDB `words`,
      pewarnaan node diganti dari tier(1/2) jadi `status` (new/learning/mastered)
  - Sama seperti tab List: **snapshot**, bukan live, sampai Sync path kelar
- [ ] Export/import JSON (`words` + `groups`)

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
