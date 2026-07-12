# Kotoba Popup — Project Spec

> Evolusi dari `flashcard-popup` (Nihongo Popup) jadi personal vocab bank dengan kanji graph.
> Base app tetap Chrome extension yang sudah ada — bukan project/aplikasi baru yang terpisah.

---

## 1. Visi

Semua kata yang pernah ditemukan — baru lihat, lagi dipelajari, sudah master —
hidup di satu database yang sama di dalam extension, cuma beda label (`status`).
Popup flashcard tetap jadi cara interaksi harian; vocab bank + kanji graph jadi
lapisan baru untuk browse dan lihat koneksi antar kata.

## 2. Non-Goals

- **Bukan multi-device.** Semua data di IndexedDB browser, tidak sync ke device lain.
- **Bukan real-time sync.** Sync dari Google Sheets tetap manual/one-click seperti sekarang.
- **Bukan SRS penuh (FSRS dll).** Tetap pakai weighted algorithm ringan yang sudah ada
  (kartu baru & sering-lupa lebih sering muncul). FSRS tetap di roadmap v2 lama, tidak
  digabung ke scope ini.
- **Bukan graph database eksternal.** Skala data kecil (puluhan-ratusan node), cukup
  di-load semua ke memory dan render — tidak butuh Neo4j dkk.

## 3. Data Model (IndexedDB)

### Object Store: `words`

| Field            | Tipe     | Keterangan                                                                                                                                |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string   | Primary key. Untuk kartu dari Sheets, tetap pakai key `kanji\|hiragana` (kompatibel dengan data lama). Untuk kartu manual, generate UUID. |
| `kanji`          | string   | Kata/kanji utama                                                                                                                          |
| `hiragana`       | string   | Cara baca                                                                                                                                 |
| `arti`           | string   | Arti/meaning                                                                                                                              |
| `notes`          | string   | Catatan bebas (existing field)                                                                                                            |
| `kanjiList`      | string[] | **Multi-entry index.** Kanji individual yang diekstrak dari `kanji`. Lihat §5.                                                            |
| `status`         | string   | `"new"` \| `"learning"` \| `"mastered"`. Auto-derived (§4), bisa manual override.                                                         |
| `statusOverride` | boolean  | `true` kalau status di-set manual, supaya auto-derivation tidak menimpa.                                                                  |
| `source`         | string   | `"sheet"` \| `"manual"`                                                                                                                   |
| `groupIds`       | string[] | **Multi-entry index.** Relasi many-to-many ke `groups`.                                                                                   |
| `seen`           | number   | Existing dari srs.js.                                                                                                                     |
| `n`              | number   | Existing dari srs.js — streak "Tau" berturut-turut, reset ke 0 tiap kena "Lupa". Dipakai langsung untuk derive `status` (§4).             |
| `easeFactor`     | number   | Existing dari srs.js.                                                                                                                     |
| `example`        | string?  | Contoh kalimat pakai kata ini.                                                                                                            |
| `tags`           | string[] | Freeform tag (mis. "N3", "anime", "kerja") — lebih ringan dari `groups`, gak butuh UI assign formal.                                      |
| `partOfSpeech`   | string?  | noun/verb/adjective/dll — buat filter & pewarnaan node graph.                                                                             |

### Object Store: `groups`

Menggabungkan konsep "deck" (sync) dan "collection" (manual) jadi satu entity:

| Field            | Tipe    | Keterangan                          |
| ---------------- | ------- | ----------------------------------- |
| `id`             | string  | Primary key                         |
| `name`           | string  | Nama tampilan                       |
| `type`           | string  | `"synced"` \| `"manual"`            |
| `sourceSheetUrl` | string? | Hanya ada kalau `type === "synced"` |

**Behavior per type:**

- `synced` — membership (`groupIds` di kartu) di-update otomatis oleh background sync. User tidak bisa hapus kartu dari sini secara manual (akan balik lagi pas sync berikutnya).
- `manual` — hanya user yang bisa tambah/hapus kartu, lewat UI vocab-bank.

**Group "General/All" — virtual, bukan disimpan.**
Tidak ada row `groups` untuk ini dan tidak pernah ditulis ke `groupIds` kartu manapun.
Di UI vocab-bank, ini cuma opsi filter yang artinya "tampilkan semua" — query-nya
`getAllWords()` biasa (bukan filter by group). Sengaja tidak disimpan sebagai
membership beneran supaya tidak ada risiko ada kartu yang "kelewat" tidak
ditandai masuk General karena lupa di salah satu titik penulisan (sync, quick-add,
migration). Tampil di UI sebagai opsi pertama/default di group selector.

## 4. Status Derivation Logic

**Tidak butuh `reviewHistory` array baru.** `n` (existing, di `srs.js`) sudah persis
streak "Tau" berturut-turut, dan sudah reset ke 0 otomatis tiap kena "Lupa"
(`applySM2` di `srs.js`). Jadi derive status langsung dari `seen`/`n` yang sudah ada:

Default threshold (taruh sebagai constant, gampang diubah):

```
new       → seen === 0 (belum pernah direview)
learning  → seen > 0, n < 3
mastered  → n >= 3
```

Kalau kartu sudah `mastered` lalu kena "Lupa" sekali → `n` reset ke 0 → otomatis
turun ke `learning` (bukan ke `new`, karena `seen` tetap > 0). Ini sudah gratis
dari behavior `applySM2` yang ada, tidak perlu logic tambahan.

Manual override: user bisa klik "mark as mastered" (atau status lain) di UI vocab-bank.
Set `statusOverride: true` supaya logic auto-derivation di atas berhenti menimpa field
ini pada kartu tersebut.

## 5. Kanji Extraction

Regex dasar: `/[\u4e00-\u9faf]/g` diterapkan ke field `kanji`.

**Edge case yang harus ditangani:** kata campuran kanji + okurigana, contoh 食べる.
Regex di atas otomatis sudah benar (hanya match karakter kanji, `食`, bukan `べる`)
karena range Unicode kanji tidak overlap dengan hiragana — tapi **wajib ditest** ke
data asli user (notes-nya pernah terbukti berantakan di project sebelumnya: dash
sebagai separator, parenthesis half-width, dll).

Jalankan extraction ini di dua titik:

1. Saat sync dari Sheets (background script)
2. Saat tambah kartu manual

## 6. Fitur

### 6.1 Popup Flashcard (existing, tidak berubah signifikan)

Baca dari `words`, alur review sama seperti sekarang. Hasil review menulis ke
`reviewHistory`, yang lalu dipakai untuk re-derive `status`.

### 6.2 Vocab Bank Page (`vocab-bank.html`, halaman baru)

- Dibuka lewat `chrome.tabs.create` dari toolbar popup atau options page.
- Browse semua `words`, filter by `status` dan/atau `groupIds`.
- Tempat untuk assign kartu ke `groupIds` (termasuk bikin group manual baru).
- Tempat export/import JSON (§8).

### 6.3 Kanji Graph (di dalam vocab-bank page)

- **Ego-centric, bukan full graph.** Render 1 node pusat + tetangga langsung (1-hop) saja.
- Klik kanji → tetangga = semua kata yang mengandung kanji itu (pakai index `kanjiList`).
- Klik kata → tetangga = kanji-kanji penyusunnya.
- Klik salah satu tetangga → graph **re-center** ke situ (fan-out ulang), bukan
  langsung render semua sekaligus — ini yang membuat "browse" jalan secara asosiatif.
- **Sumber implementasi: port dari project Kotoba** (force-sim custom, styling
  "cozy" — Zen Maru Gothic, washi paper, tile node dengan drop shadow). Hanya
  data-fetching layer yang diganti dari SQLite/sample data → IndexedDB extension.
  Physics simulation, animasi transisi (collapse-to-center → bloom-from-center),
  dan visual style dipakai apa adanya.
- Node diwarnai berdasarkan `status` (new/learning/mastered).

### 6.4 Tambah Kartu Manual

- **Quick-add** di toolbar popup: form kecil (kanji, hiragana, arti) untuk capture
  cepat. Default `groupIds: []` (masuk "Uncategorized").
- **Full edit** di vocab-bank page: assign/ubah `groupIds` kartu manapun (manual
  atau dari Sheets), termasuk bikin group manual baru.
- Semua kartu manual masuk object store `words` yang sama dengan kartu dari
  Sheets (dibedakan lewat field `source`), supaya flashcard, graph, dan status
  semuanya melihat kartu manual persis seperti kartu dari Sheets — tidak ada
  logic bercabang di kode.

## 7. Migrasi dari `chrome.storage.local`

Data lama (kartu + progress review) tersimpan di `chrome.storage.local`. Perlu
one-time migration script:

1. Cek flag "sudah migrasi" (misal `localStorage`/IndexedDB kecil bernama `_migrated: true`).
2. Kalau belum: baca semua data lama dari `chrome.storage.local`.
3. Transform ke schema baru (§3) — key kartu lama (`kanji|hiragana`) dipakai
   sebagai `id`, `source: "sheet"`, extract `kanjiList`, derive `status` awal
   dari `reviewHistory` yang sudah ada.
4. Tulis ke IndexedDB.
5. Set flag migrasi selesai. **Jangan hapus data lama** sampai yakin migrasi
   sukses (safety net).

**Wajib ditest hati-hati** — ini progress belajar asli user, tidak boleh hilang.

### 7.1 Collision Handling

Data lama nested per-deck (`state.cards[deckId][kanji|hiragana]`), jadi kata yang
sama bisa punya entry terpisah (dengan `seen`/`n`/`easeFactor` masing-masing) di
lebih dari satu deck. Setelah di-flatten ke `id` global, entry-entry ini collide.

Karena datanya cuma counter agregat (bukan log ber-timestamp), tidak ada cara
"gabung kronologis" yang valid — begitu collide, salah satu histori counter pasti
tidak terpakai. Aturan:

1. **Progress yang dipertahankan** = entry dengan `n` lebih tinggi (tie-break:
   `seen` lebih tinggi). Alasan: representasi paling akurat soal kata itu udah
   dikuasai atau belum, dibanding rata-rata yang malah mengaburkan.
2. **`groupIds` di-union** dari semua deck asal — kartu tetap kelihatan di semua
   deck asalnya walau progress-nya cuma satu set.
3. **Log setiap collision** (id, deck mana yang menang, `n`/`seen` masing-masing
   pihak) ke console/file supaya bisa direview manual setelah migrasi.
4. **Flag khusus kalau `arti` beda** antar entry yang collide — bisa jadi bukan
   duplikat asli, tapi kebetulan kanji+hiragana sama dengan makna beda (homofon).
   Jangan di-merge diam-diam, munculkan di log biar user cek manual.

## 8. Backup / Export — Wajib Ada Sejak Awal

Karena semua data hidup di IndexedDB (browser-only, no backend), ada risiko nyata:
uninstall extension, clear browsing data, atau ganti device = seluruh vocab bank
hilang, termasuk kartu manual dan progress mastery yang tidak ada duplikatnya di
Google Sheets.

- **Export**: satu tombol di vocab-bank page → download semua isi `words` + `groups`
  sebagai satu file JSON.
- **Import**: upload file JSON tadi → restore/merge ke IndexedDB.

Ini jauh lebih murah dibangun bareng dari awal dibanding ditambahkan belakangan
setelah user sudah kehilangan data.

## 9. Struktur Kode

```
manifest.json              izin + pendaftaran (tambah permission storage unlimited jika perlu)
background.js              service worker: sync, alarm, migration trigger (di root — dibatasi Chrome)
content.js                  overlay flashcard, tidak berubah (di root — didaftarkan sebagai content script)
lib/papaparse.min.js       existing

core/                       modul logic, di-load lewat importScripts (background.js) / <script> (pages/)
  srs.js                    existing — pickCard, applySM2, + deriveStatus (BARU)
  kanji.js                  BARU — kanji extraction util
  db.js                     BARU — layer akses IndexedDB (open/upgrade, CRUD words & groups)
  migrate.js                BARU — one-time migration dari chrome.storage.local

pages/                       semua UI surface
  popup.html/js/css          toolbar: quiz sekarang / sync / quick-add / buka vocab-bank
  options.html/js/css        kelola deck+group, atur frekuensi (existing)
  vocab-bank.html/js/css     BARU — browse words, assign group, export/import
  graph.js/css               BARU — kanji graph (di dalam vocab-bank.html, tab terpisah)

reference/
  kanji_explore.html         prototype project "Kanji" asli — sumber yang di-port ke pages/graph.js
```

## 10. Urutan Kerja yang Disarankan

1. `db.js` — schema IndexedDB + versioning (`onupgradeneeded`)
2. `migrate.js` — migrasi data lama, test dengan data asli
3. Kanji extraction util + test ke data asli (edge case okurigana dkk)
4. Status derivation logic
5. Adaptasi background.js sync untuk tulis ke IndexedDB (bukan storage.local lagi)
6. Quick-add di popup
7. vocab-bank.html — list/filter view dulu (tanpa graph)
8. Port graph dari Kotoba, ganti data source
9. Export/import JSON

## 11. Keputusan Terbuka yang Masih Perlu Diambil Saat Coding

- Nama exact untuk group default kartu manual tanpa group (`"Uncategorized"`?)
- Apakah butuh versi IndexedDB schema di-bump kalau nanti nambah field lagi (siapkan `onupgradeneeded` yang defensif dari awal)
- UI detail quick-add: validasi field kosong, duplicate detection (kartu manual yang kebetulan sama kanji+hiragana dengan yang sudah ada dari Sheets)
