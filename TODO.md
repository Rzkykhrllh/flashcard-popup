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

- [x] `vocab-bank.js/css` — browse semua `words`, filter by `status`/`groupIds`
      (tab status + dropdown group, termasuk opsi virtual "All (General)"),
      plus search box. **Live** — status ke-update begitu direview di popup.
- [x] Kanji graph (ego-centric, 1-hop) — di-port dari `reference/kanji_explore.html`
      (project "Kanji"). Fisika/animasi/visual style dipertahankan apa adanya;
      data source diganti ke IndexedDB `words`, pewarnaan node diganti dari
      tier(1/2) jadi `status` (new/learning/mastered). Fullscreen toggle pakai
      native Fullscreen API.
- [x] Export/import JSON (`words` + `groups`), dengan konfirmasi jumlah
      baru/ketimpa sebelum eksekusi

### Konsolidasi halaman

- [x] `vocab-bank.html` dihapus — List & Graph digabung jadi tab di `options.html`,
      satu tab-nav: **Settings | List | Study | Graph**. Tab Stats lama dipensiunin
      (dead code `renderStats` + CSS-nya dihapus) — List sudah strict upgrade-nya
      (ada filter status/group/search yang Stats gak punya). Popup toolbar tombol
      "Kotoba Bank" sekarang ke `options.html#list`.
  - **Penting**: `db.js`, `vocab-bank.js`, `graph.js`, `options.js` semuanya
    `<script>` classic (bukan module) di 1 halaman → **share 1 global scope**.
    Nama top-level (`const`/`let`/`function`) yang sama di 2 file bakal bentrok
    jadi `SyntaxError` yang mematikan SELURUH script itu diam-diam (kejadian
    beneran 2x: `STATUS_LABEL`, `render`). Kalau nambah top-level identifier baru
    di salah satu file ini, cek dulu gak collide sama yang lain.
  - Urutan `<script>` di `options.html` wajib: `db.js` → `kanji.js` →
    `vocab-bank.js` → `word-editor.js` → `kanji-tab.js` → `graph.js` →
    **`options.js` paling akhir** (dia langsung manggil `switchTab()` dari
    hash URL di top-level-nya sendiri, butuh `reloadData`/`startGraph` udah
    ke-define duluan). Sekarang 7 script share 1 scope — selalu cek collision
    kalau nambah top-level identifier baru.

### Manual add + word/kanji detail card

- [x] `word-editor.js` — modal add/edit word (kanji, hiragana, meaning, notes)
      dari tab List. Add mode: pilih collection existing atau bikin baru
      (`type:"manual"`). Edit mode: gak bisa ubah collection dari sini (itu
      backlog "UI assign group manual" di bawah) — fokus cuma edit teks.
  - Kalau kanji+hiragana yang diketik udah ada (collision), user dikonfirmasi
    dulu, terus di-merge — progress (`n`/`seen`) yang lebih maju yang menang,
    aturan sama persis kayak collision handling di `core/migrate.js`.
  - Ganti kanji/hiragana pas edit = ganti `id` (keyPath IndexedDB) → delete
    lama + put baru, bukan update in-place.
- [x] Kanji detail card — klik kanji-chip di dalam word editor → sub-modal
      nampilin kanji, **on'yomi/kun'yomi** (otomatis dari `data/kanjidic.json`),
      dan kata lain di bank yang pakai kanji itu (klik salah satu → lompat ke
      word editor kata itu, chain-navigable).
  - `data/kanjidic.json` — turunan kompak dari **KANJIDIC2** (EDRDG, CC BY-SA
    4.0, attribution di README.md), cuma ambil field `on`/`kun` per kanji
    (12.356 kanji, ~640KB). Di-fetch lazy (sekali, di-cache) pas kanji card
    pertama kali dibuka — gak nge-block load halaman.
- [x] Kanji card di-revamp: **meaning + notes kanji manual** (bukan dari
      dict) — store `kanjiMeta` di IndexedDB (`db.js` v2, keyPath `char`,
      field `meaning` + `notes`), field `on`/`kun` tetap dari
      `data/kanjidic.json`, gak pernah ke-mix.
  - Layout kanji card disamain sama word view card (kanji besar di tengah,
    section berlabel + divider) — sebelumnya cuma list `<h2>`+form polos.
- [x] Tab **"Kanji"** baru — browse semua kanji yang pernah muncul di kata-kata
      (auto dari `kanjiList`), sortable by usage count, search by
      kanji/meaning/notes. Klik row → buka kanji card yang sama (reuse dari
      word editor). Kolom: Kanji | On'yomi | Kun'yomi (masing-masing kolom
      sendiri, tapi compact — cuma referensi) | Meaning | Notes |
      **Words containing it** (tampilin katanya langsung, bukan cuma angka
      "used in N" — di-cap 6 kata + "+N more", full list tetep ada di kanji card).
- [x] Word card di-revamp jadi 2 mode dalam 1 modal: **View** (default pas
      klik kata existing — furigana kecil di atas, kanji besar di tengah
      *(tiap kanji individual clickable → kanji card)*, meaning, lalu section
      Example/Notes yang jelas berlabel + divider, dipisah dari card utama)
      dan **Edit** (form, default pas Add). Field baru: **example** (contoh
      kalimat). Delete di-de-emphasize (ghost, misah jauh dari Edit/Save)
      biar gak kepencet gak sengaja.
- [x] **"+ Add word" di popup — inline, gak redirect.** Awalnya buka tab baru
      ke `options.html#add-word`, sekarang jadi form kecil langsung di popup
      (`popup.html` juga load `core/db.js`+`core/kanji.js`). Logic sama kayak
      Add mode di `word-editor.js` (collision/merge rule sama), tapi
      duplicated di `popup.js` sendiri karena popup & options.html gak pernah
      share 1 halaman/scope. Hash `#add-word` di `options.js` udah dihapus
      (gak dipakai lagi).

## Housekeeping

- [x] Tidy foldering: `core/` (db.js, kanji.js, migrate.js, srs.js), `pages/`
      (semua HTML/JS/CSS UI + graph.js/css), `reference/` (kanji_explore.html asli).
      `manifest.json`, `background.js`, `content.js`, `lib/` tetap di root.
      Semua path silang (manifest, importScripts, chrome.runtime.getURL, script/link
      src) sudah diupdate & diverifikasi resolve ke file yang benar.
- [x] **Palette audit + fix (WCAG contrast, dihitung pakai formula resmi, bukan
      nebak)** — `options.css`/`popup.css` sebelumnya punya `--muted` (#888/#777)
      yang GAGAL AA (3.2-3.7:1) di kedua mode, dipakai luas ke mana-mana
      (hint text, timestamp, furigana di flashcard `content.js`!). Ketemu +
      dibenerin:
  - Neutral scale sekarang 3 tier teks (`--ink`/`--ink-2`/`--muted`, bukan
    cuma 2), semua tervalidasi >=4.5:1 di kedua mode. `--ink-2` dipakai di
    `.reading-cell` (isi hiragana di tabel, sebelumnya `--muted` yang gagal).
  - `.status.ok/.err`, `.cell-know/.cell-hint/.cell-lupa`, `.ratio-fill`,
    `.deck .rm:hover`, `.btn.ghost-danger:hover` — semua dapet dark-mode
    variant yang tervalidasi (sebelumnya cuma versi light, ~2.2-2.9:1 di dark).
  - `content.js` (flashcard overlay) — `--muted` dibenerin juga (dipakai buat
    `.furigana`, bukan sekadar hint).
  - `graph.css` — `--gmuted` dibenerin (light-only, gak nambah dark mode ke
    tab Graph — itu belum ada sama sekali di sana, lihat catatan di bawah).
  - Kanji di tabel (`kanji-cell`) dibesarin 15px → 21px — kekecilan buat app
    yang isinya kanji. Padding sel tabel ikut dilonggarin (8px → 10px).
  - **Belum dikerjain**: tab Graph gak punya dark mode sama sekali (fixed
    washi palette, ported apa adanya dari prototype asli). Kalau mau ini
    juga di-dark-mode-in, itu kerjaan desain terpisah (bikin varian washi
    gelap), bukan cuma fix kontras.
- [x] **Manual Light/Dark/System toggle** (Settings → Appearance) — sebelumnya
      cuma ngikutin `prefers-color-scheme` OS, gak ada override di app.
      `settings.colorMode`: `"system"` (default) | `"light"` | `"dark"`.
  - **Restructure arsitektur**: `options.css`/`popup.css`/`vocab-bank.css`
    sebelumnya pakai `@media (prefers-color-scheme: dark)` tersebar di 11
    tempat. Diganti total jadi `html[data-theme="dark"]` — JS (options.js/
    popup.js) SELALU nentuin `data-theme` eksplisit (resolve "system" via
    `matchMedia` sekali, listen buat perubahan live), gak pernah dibiarin
    kosong. Satu sumber kebenaran, gak ada dua mekanisme (media query +
    attribute) yang bisa balapan spesifisitas.
  - **Nemu bug kepisah pas ngerjain ini**: `applyActiveTheme()` di
    `options.js` nge-set `--shu` lewat **inline style**, yang otomatis
    menang atas media query CSS apapun — jadi accent color di options.html
    dark mode selama ini diam-diam make warna versi LIGHT (`#2563eb`, cuma
    2.78:1 di dark surface, gagal AA) alih-alih versi dark yang bener
    (`#3b82f6`, 3.90:1). `THEME_COLORS` ditambah field `dk` (dark-mode
    accent, disamain sama `content.js`'s `ACCENT.dk`/popup.css), dipilih
    lewat `isDarkActive()`.
  - `content.js` (flashcard) di-restructure serupa — `isDark` dihitung sekali
    di awal `render()` (baca `settings.colorMode`), neutral+accent colors
    dipilih langsung di JS, `@media` dihapus (toh style-nya di-generate ulang
    tiap kartu muncul).
  - Tab Graph gak kesentuh (gak butuh — dia fixed-light, gak baca token
    `--ink`/`--muted`/dst app-wide sama sekali, jadi `data-theme` gak
    ngaruh ke situ).
- [x] **Settings tab di-reorganize** jadi 2 section dengan label eksplisit:
      **General** (Appearance+Color theme — app-wide, dipake Kotoba Bank
      juga; Add deck; Your decks) vs **Flashcard popup** (Study mode;
      Frequency & behavior; Flashcard appearance — furigana/reveal/posisi).
      "Popup" di sini = overlay flashcard di halaman web (`content.js`),
      BUKAN toolbar popup extension.
  - Klarifikasi konsep: **deck = group dengan `type:"synced"`** — udah
    otomatis kejadian dari awal (`background.js` nulis `putGroup({id:
    deck.id, ...})` tiap sync), cuma belum eksplisit di UI. Ditambah hint
    di panel "Your decks" biar kelihatan.
- [x] Beberapa polish kecil:
  - Tab nav: label "List" → **"Words"** (id internal `data-tab="list"` /
    `id="tab-list"` gak diubah, cuma display text).
  - Urutan tab: **Study sebelum Stats** (dulu Stats duluan).
  - Panel **Backup (Export/Import)** dipindah dari tab Words ke Settings,
    section baru **"Words"** (di antara General & Flashcard popup) — JS-nya
    (`vocab-bank.js`) gak perlu diubah, `getElementById` kerja lintas
    tab-pane apapun.
  - App title/description diganti: manifest.json `name`/`description`,
    `default_title`, dan hero tag di `options.html` — sekarang jelasin app-nya
    udah jadi vocab bank + kanji graph + dictionary, tapi tetep highlight
    "flashcard pop up while you browse" sebagai keunggulan utama.
- [x] Urutan tab final: **Settings | Study | Words | Kanji | Stats | Graph**.
- [x] **Klarifikasi checkbox seleksi di tab Study** — sebelumnya gak ada
      penjelasan sama sekali kalau checklist di situ nentuin kata mana yang
      eligible muncul di popup flashcard di halaman web. Ditambah hint teks
      + header kolom "In popup" + summary di-rename jadi "Which words show
      in the popup".
  - **Nemu gotcha nyata** pas ngecek ini: tombol "Clear" (sekarang di-rename
    "Deselect all") itu nyisain objek seleksi `{}` (bukan `undefined`) di
    `chrome.storage.local`, dan `{}` itu truthy di JS — jadi `pickCard()` di
    `srs.js` nge-skip SEMUA kartu di deck itu, bukan reset ke "semua
    eligible" kayak yang biasanya diharapkan orang pas klik "Clear". Hint
    teks-nya udah jelasin ini eksplisit biar gak jadi jebakan diam-diam.
- [x] Urutan tab final v2: **Study | Words | Kanji | Stats | Graph | Settings**
      (Study tetap pertama/default, Settings pindah ke paling akhir).
- [x] Panel **Backup (Export/Import)** balik lagi ke tab Words (batalin
      pemindahan ke Settings sebelumnya) — final: Backup tetap di tab Words.
- [ ] **Diskusi, belum dieksekusi**: pindahin "Add deck" + "Your decks" dari
      Settings ke tab Study — biar semua kontrol "kata mana yang muncul di
      popup" (level-deck via toggle enable/disable, level-kata via checkbox)
      jadi satu tempat, bukan kepencar Settings vs Study. Ketauan juga toggle
      enable/disable deck di "Your decks" sekarang **overlap** sama
      "Deselect all" di Study (dua-duanya bikin nol kartu dari deck itu
      eligible di popup) — bukan alasan buat dihapus (toggle lebih cepat
      buat pause 1 deck penuh), tapi kuat alasan buat digabung satu tempat.

## Next Version (post-MVP)

- [ ] UI assign/ubah group/collection kartu yang **udah ada** (sekarang cuma
      bisa di-set pas Add; edit mode gak bisa reassign collection)
- [ ] Manual status override (tombol "mark as mastered" dkk, set `statusOverride: true`)
- [ ] Kolom tambahan: `tags`, `partOfSpeech` — field udah dialokasikan di
      schema (next_feature.md §3), belum ada UI buat isi/edit (`example` udah
      kelar, lihat "Manual add + word/kanji detail card" di atas)
- [ ] `manifest.json` — permission `unlimitedStorage` kalau ternyata dibutuhkan
      setelah data tumbuh
