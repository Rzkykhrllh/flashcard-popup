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

- [x] **Tab Study: opsi "All decks"** — dulu cuma bisa pilih 1 deck di dropdown,
      sekarang ada opsi `All decks` (default) yang gabungin kata dari semua
      deck jadi satu list buat di-review/di-select.
  - Kata yang sama bisa nyangkut di lebih dari 1 deck (`groupIds`), jadi
    `buildStudyEntries()` dedup per `key` dan numpuk `deckIds`-nya biar gak
    dobel muncul pas mode "All decks".
  - Eligibility & toggle checkbox jalan OR-across-decks: `isWordEligible()`
    ngecek `.some()` ke semua `deckIds` punya entry, toggle nulis ke seleksi
    tiap deck yang relevan — konsisten sama cara `srs.js` beneran nge-pool
    kartu buat popup (bukan aturan baru).
  - **Gotcha yang sama kayak bug "Clear" lama** kejadian lagi pas nulis
    `isWordEligible()` versi pertama: sempet nge-treat objek seleksi kosong
    `{}` sama kayak `undefined` (untouched), padahal keduanya beda makna.
    Ketauan dari test Node manual sebelum dianggap kelar, bukan dari user
    report — fix-nya cek `sel === undefined` eksplisit.
- [x] **Hapus kanji "加" dari tombol Add word** — di `options.html`
      (`#addWordBtn`) dan `popup.html` (`#addWordShortcut`), balik jadi plain
      "Add word". Teks "加 New collection…" di form add-word gak diubah
      (gak diminta).
- [x] **Icon extension diganti jadi kanji 字** ("karakter/huruf" — nyambung ke
      漢字/文字, cocok buat app belajar kanji). Diganti dari desain lama
      (kotak biru rounded + tanda "+" putih) jadi kotak rounded warna tema +
      字 putih di tengah, generate ulang buat semua size (16/48/128) dan
      semua varian tema (root=blue, red, purple, green) via script PIL,
      font PingFang TC Semibold (index 7 di `PingFang.ttc`) abis dibandingin
      sama Hiragino Sans GB dan AquaKana.
  - Kenapa 字 dan bukan kanji lain: awalnya coba 語 (14 stroke) tapi udah
    muddy/gak jelas pas disimulasiin di ukuran 16px — jadi dicoba beberapa
    alternatif stroke rendah (単, 文, 和) dan 字 (6 stroke) menang paling
    jelas di toolbar-size.
  - **Di-revert**: kanji ternyata gak enak diliat di icon beneran (bukan cuma
    simulasi 16px). Dicoba 3 alternatif non-text (torii gate, tumpukan
    flashcard, hiragana あ lebih ringan) — torii paling tahan banting di
    ukuran 16px asli (murni bentuk geometris, gak ada garis tipis yang
    ilang pas di-downscale), tapi user minta balik ke desain awal (kotak
    biru rounded + tanda "+" putih) dulu buat sementara. Icon di-`git
    checkout` balik ke commit sebelum redesign, bukan digenerate ulang —
    exact pixel yang sama kayak awal.
- [x] **Tab Study & Stats: unifikasi "category"** — sebelumnya "Deck" di
      kedua tab itu cuma nunjuk ke `chrome.storage.local.decks` (deck sync
      Google Sheet doang). Kata yang cuma ada di **manual collection**
      (dibuat via "New collection" pas nambah kata manual) gak pernah
      punya entry di situ, jadi:
  - **Bug yang ketemu (bukan diminta, ditemuin pas investigasi)**: kata yang
    cuma tergabung ke manual collection gak pernah muncul di Study, Stats,
    ATAU popup flashcard di halaman web — `getState()` di `background.js`
    cuma bikin `cards[deckId]` buat deck id yang ada di `decks`
    (chrome.storage.local), jadi `groupId` manual collection gak pernah
    cocok, kata-nya keresap diam-diam.
  - **Fix**: `getState()` sekarang juga bikin `categories` = semua group di
    IndexedDB (`getAllGroups()`) — gabungan deck sync + manual collection.
    Group sync ke-merge sama data deck-nya (enabled/url/lastSynced dari
    `chrome.storage.local`), group manual dapet default `enabled: true`.
    `cards` sekarang dibangun dari `categories`, bukan `decks` doang.
    `decks` sendiri **gak diubah** — tetep dipake apa adanya di Settings
    tab "Your decks" (add/remove/toggle sync deck), supaya gak nyampur 2
    konsep beda (manage sync config vs. filter tampilan).
  - `srs.js`'s `pickCard()` di-update iterate `state.categories` (bukan
    `state.decks`) — jadi kata dari manual collection sekarang beneran
    bisa muncul di popup flashcard juga, gak cuma di Study/Stats.
  - Tab **Study**: dropdown "Deck" di-relabel jadi **"Category"**, opsi
    "All decks" jadi **"All categories"**, sumber datanya `state.categories`.
  - Tab **Stats**: dulu selalu nampilin SEMUA deck ke-stack vertikal
    sekaligus (list kepanjangan kalau kategorinya banyak) — sekarang ada
    dropdown yang sama kayak Study (**Category**, default **All
    categories**), milih 1 kategori nyaring ke section itu doang.
  - Diverifikasi lewat Node test manual: `pickCard()` bisa ke-pick kata dari
    kategori manual-only, `buildStudyEntries("__all__")` gabungin count dari
    2 kategori dengan bener, `isWordEligible()` tetep default-eligible buat
    seleksi yang belum disentuh.
- [x] **Fix bug: checklist "popup eligibility" nge-reset queue Study** —
      abis rilis fitur Category di atas, ke-report kata2 yang mau dipelajari
      auto "ke-reset" pas checkbox di-centang/dropdown pindah.
  - **Root cause**: `studyState.cards` (queue Study) di-filter pake
    `isWordEligible()` — fungsi yang sama yang nentuin eligibility buat
    popup flashcard di halaman web. Begitu user centang SATU checkbox aja
    di kategori manapun, `selection[categoryId]` jadi objek yang ke-define
    (gak lagi `undefined`), dan per aturan `pickCard`, itu bikin SEMUA kata
    lain di kategori itu yang belum eksplisit dicentang jadi ineligible —
    otomatis ilang dari queue Study meskipun user cuma niat nambahin 1 kata,
    bukan ngurangin yang lain.
  - **Fix**: queue Study sekarang murni dari kategori yang dipilih dropdown
    doang (`entries`), gak difilter `isWordEligible()` lagi sama sekali —
    checkbox "which words show in the popup" balik jadi kontrol yang
    beneran terpisah, cuma ngaruh ke popup flashcard di web (state.selection
    dibaca `srs.js`'s `pickCard()`), gak nyentuh apa yang ditampilin di
    Study. Text hint di bawah checklist diupdate biar jelas ini 2 hal beda.
  - `isWordEligible()` jadi gak kepake lagi di manapun makanya dihapus
    (dead code) — begitu juga flag `_selectionChanged` yang sebelumnya
    dipake buat trigger rebuild queue tiap checkbox di-toggle.
  - Diverifikasi ulang: `buildStudyEntries("A")` sekarang tetep return 4
    kata biarpun `selection.A` udah ada isi 1 kata eksplisit — gak lagi
    ke-reduce jadi 1 kayak sebelum fix.
- [x] **Fix beneran root cause-nya + redesign Study table** — fix sebelumnya
      (yang mecah queue Study dari checkbox eligibility) ternyata cuma
      mindahin masalahnya, bukan nyelesain akar masalahnya, dan bikin queue
      Study jadi gak nyambung sama jumlah kata yang di-check. User report:
      "study flashcard error, belum sesuai sama jumlah yang di check."
  - **Akar masalah yang sebenernya**: `selection[deckId][key]` makenya
    "key ada = eligible", jadi begitu 1 kata eksplisit di-centang, seluruh
    kata LAIN yang belum disentuh di kategori itu ikut ke-anggep excluded
    (karena objek selection-nya udah "ada isinya"). Ini bug yang sama yang
    udah 3x muncul dalam bentuk beda-beda (bug "Clear" lama, bug
    `isWordEligible` gua sendiri, dan bug "reset pas pindah dropdown").
  - **Fix final**: `setCardSelection` (background.js) sekarang nyimpen
    `true`/`false` eksplisit, bukan "ada key = true, gak ada = false".
    `pickCard` (srs.js) dan `isWordEligible` (options.js, di-hidupin lagi)
    aturannya jadi: **eligible KECUALI eksplisit `false`** — key yang gak
    ada di objek selection artinya "belum ada keputusan, tetep eligible",
    BUKAN "excluded". Centang 1 kata sekarang gak lagi nyenggol kata lain
    sama sekali.
  - **Queue Study** balik nyambung ke eligibility (bukan ke dropdown
    kategori lagi) — jumlah kartu di sesi Study sekarang PERSIS jumlah kata
    yang eligible/checked, sesuai yang diminta.
  - **Redesign tabel checklist** ("Which words show in the popup"): sekarang
    punya search bar (`#browseSearch`) + filter kategori sendiri
    (`#browseCategorySelect`, default "All categories") yang MURNI buat
    narrow-down tampilan tabel doang — gak nyentuh queue Study atau
    selection sama sekali. Dropdown "Category" yang dulu ada di atas
    (buat scope queue Study) dihapus total, diganti sepenuhnya sama
    eligibility checkbox.
  - **Tambahan (saran user)**: form Add Word (modal di tab Words, dan
    quick-add di popup toolbar) sekarang punya checkbox **"Include in
    current learning (Study & popup)"**, default tercentang — biar bisa
    nambah kata ke bank tanpa langsung masuk rotasi Study/popup kalau mau.
  - Diverifikasi lewat Node test: cek 1 kata di kategori A gak ngurangin
    9 kata total jadi kurang dari 9 (tetep 9), exclude eksplisit 1 kata baru
    beneran ngurangin jadi 8 dan kata yang excluded itu yang bener. `pickCard`
    (popup asli) diverifikasi pake aturan yang sama.

- [x] **Klik row di tabel checklist Study buka detail kata** — sebelumnya
      row di tabel "Which words show in the popup" cuma bisa di-toggle
      checkbox-nya, gak ada cara liat detail kata dari situ tanpa pindah ke
      tab Words dulu. Sekarang klik row (di luar area checkbox) buka modal
      detail kata yang sama kayak di tab Words, termasuk bisa klik kanji di
      dalemnya buat lanjut ke kanji modal (detail + navigasi, bukan cuma
      pilih doang). Diverifikasi end-to-end pake Playwright (extension asli
      di-load, bukan cuma baca kode): klik checkbox gak buka modal, klik row
      buka modal, klik kanji di modal buka kanji modal.
- [x] **UI assign/reassign collection kartu yang udah ada, dan 1 kata bisa
      masuk banyak collection sekaligus** — sebelumnya cuma bisa pilih 1
      collection, dan cuma pas Add (edit mode gak bisa sentuh groupIds sama
      sekali).
  - Form Add/Edit Word (`#wGroupField` di tab Words, `#qaGroupChecklist` di
    quick-add popup) sekarang checklist (bukan `<select>` single-value) —
    bisa centang berapa aja collection, dan "+ Add" bikin collection baru
    inline lalu auto-tercentang, tanpa nutup form.
  - Edit mode sekarang nampilin checklist ini juga (sebelumnya disembunyiin
    total — "belum in scope"), pre-checked ke `groupIds` kata itu. Save akan
    REPLACE `groupIds` kata itu persis sama apa yang dicentang (termasuk
    ngurangin, bukan cuma nambah).
  - Rename (kanji/hiragana berubah, id ikut berubah) yang collide sama kata
    LAIN tetep union groupIds-nya (gak nyabut collection kata yang di-merge
    itu), tapi kalau gak collide, groupIds-nya langsung diganti sesuai
    checklist (gak di-union sama yang lama).
  - Checkbox "Include in current learning" tetep cuma di mode Add (gak
    diubah scope-nya) — di-apply rata ke SEMUA collection yang baru
    dicentang. Eligibility per-collection buat kata yang UDAH ada tetep
    diatur lewat checklist "Which words show in the popup" di tab Study
    (lebih tepat buat itu, granular per-kategori).
  - Diverifikasi end-to-end pake Playwright: bikin kata + assign ke 2
    collection baru sekaligus → tersimpan bener di IndexedDB (`groupIds`
    berisi keduanya); buka lagi → checklist ke-precheck bener; uncheck 1 +
    tambah collection baru + save → `groupIds` akhir sesuai (union/replace
    jalan sesuai desain). Dites juga versi popup quick-add-nya sama caranya.
- [x] **Rename collection/deck** — tombol pensil (✎) di tiap row checklist
      collection (tab Words & quick-add popup), klik buka inline text input
      + Save/Cancel, gak perlu pindah halaman.
  - Checkbox row TETAP ada di DOM pas lagi mode edit nama (cuma nama-nya aja
    yang diganti jadi `<input>`) — sengaja gitu biar `selectedGroupIds()`
    gak pernah kehilangan state "yang dicentang" pas satu row lagi di-edit.
    Awalnya desain pertama nyembunyiin checkbox pas edit-mode dan itu jadi
    bug (centang ke-reset abis rename) — ketauan pas nulis draft-nya sendiri
    sebelum sempet nge-test, jadi di-redesign biar checkbox-nya persist.
  - Message baru `renameGroup` di background.js: kalau id-nya cocok sama
    salah satu deck sync (`chrome.storage.local.decks`), update nama di
    KEDUA tempat (deck config + mirror-nya di IndexedDB `groups`) — biar
    panel "Your decks" di Settings tetep sinkron. Kalau manual-only, cuma
    update IndexedDB group-nya.
  - Diverifikasi lewat Playwright: rename collection manual → nama
    ke-update langsung di checklist, checkbox tetap kecentang, dropdown
    filter collection di tab Words ikut ke-update (`reloadData()`), dan
    persist bener di IndexedDB abis reload. Tombol Cancel dites juga —
    dipastikan gak nyimpen perubahan yang belum di-Save.
- [x] **Diskusi**: tab Study & Words kerasa redundant (dua-duanya jadi
      tabel kata yang bisa di-search/filter/klik-buka-detail). Kesimpulan
      setelah diskusi (bukan merge tab): checklist di Study TETAP dipertahanin
      apa adanya — mindahin kata mana yang mau di-review itu perlu bisa
      langsung lanjut belajar tanpa pindah tab, jadi worth duplikasinya.
      Yang beneran kurang: eligibility ("In Study/popup") cuma bisa
      diliat/diubah dari tab Study, gak ada di tab Words sama sekali.
  - **Fix**: tab Words dapet kolom baru **"In Study"** (checkbox) di tabel
    kata-nya, reuse `isWordEligible()`/`setWordSelection()` yang udah ada
    di options.js (bukan re-implement aturan "explicit false excludes"-nya
    lagi, biar gak ada versi ketiga yang bisa beda bug). Toggle dari tab
    Words langsung kelihatan sinkron di tab Study juga (satu sumber data:
    `state.selection`).
  - **Isu ordering yang dicek**: `vocab-bank.js` (tab Words) manggil
    `isWordEligible`/`setWordSelection`/`send` yang didefinisiin di
    `options.js`, padahal `<script>` tag options.js dimuat BELAKANGAN di
    `options.html`. Aman karena semua pemanggilannya ada di dalem callback
    async (`reloadData()`/event listener), yang baru jalan setelah SEMUA
    `<script>` tag lain kelar dieksekusi duluan (browser jalanin script tag
    berurutan secara sinkron, baru abis itu microtask/promise continuation
    jalan) — diverifikasi gak ada console error sama sekali pas load.
    Tabel Words sekarang punya 6 kolom (nambah "In Study"), `colspan`
    loading-placeholder-nya di-update dari 5 ke 6.
  - Diverifikasi end-to-end pake Playwright: checkbox default state bener
    (untouched = eligible = tercentang), klik row (bukan checkbox) tetep
    buka word modal, klik checkbox gak ikut buka modal & beneran nge-toggle
    eligibility yang persist ke storage, dan tab Study nunjukin state yang
    sama abis toggle dari tab Words (satu sumber data, bukan dua yang bisa
    ketuker).
- [x] **Rapihin tombol popup toolbar** — dari 7 tombol (Show card now, Menu
      toggle, Study, Kotoba Bank, Add word, Sync from Google Sheet, Settings
      & decks) jadi 3 tombol flat: **Show card now**, **Add word**, **Open
      Kotoba Bank**.
  - **Study/Kotoba Bank/Settings & decks** — ketiganya cuma buka
    `options.html` dengan hash tab awal beda-beda (`#study`/`#list`/
    `#settings`). Digabung jadi 1 tombol **Open Kotoba Bank** (buka
    `options.html` tanpa hash, default landing di tab Study) — tab bar-nya
    udah keliatan begitu halamannya kebuka, jadi gak butuh 3 pintu masuk
    beda buat halaman yang sama.
  - **Sync from Google Sheet** dihapus dari popup — tab Settings udah punya
    tombol "Sync all" sendiri, jadi ini murni dobel. Sync sekarang cuma
    bisa lewat Settings (1 klik ekstra lewat "Open Kotoba Bank").
  - **Menu ▾ collapsible dihapus** — cuma worth dipertahanin kalau tombolnya
    banyak; abis dikurangin jadi 3, tampilin flat langsung lebih sedikit
    klik buat sampe ke aksi manapun.
  - `.menu-toggle`/`.submenu` CSS yang jadi gak kepake dihapus juga.
  - Diverifikasi lewat Playwright + screenshot: 3 tombol keliatan flat,
    "Add word" masih buka quick-add form dengan bener, gak ada console
    error.
- [x] **Rename collection makin gak kelihatan tempatnya** — user komplain
      "masih gak gitu keliatan harus dimana", padahal fitur rename-nya udah
      ada (ikon pensil). Root cause: satu-satunya tempat ikon itu muncul
      adalah checklist collection di modal Add/Edit Word (word-editor.js) &
      quick-add popup — gak ada yang bakal mikir "buat rename collection,
      buka form tambah kata dulu". Semua tempat lain yang nampilin nama
      collection (dropdown filter Study/Stats/Words, kolom "Groups" di tabel
      Words, panel "Your decks" di Settings) read-only, gak ada rename.
  - **Fix**: panel "Your decks" di Settings di-generalize jadi **"Your
    collections"** — sekarang loop dari `state.categories` (superset semua
    grup, bukan cuma `state.decks` yang sync doang), jadi collection manual
    (dibikin lewat "New collection" pas nambah kata) ikut muncul di sini,
    bukan cuma deck sync. Tiap row dikasih ikon pensil (reuse
    `.group-rename-*` CSS class yang sama persis dari word-editor.js/
    vocab-bank.css, biar konsisten & gak dobel style) yang buka inline
    text input + Save/Cancel, kirim message `renameGroup` yang sama.
  - Toggle enable/disable (`.switch`) cuma ditampilin buat collection yang
    sync (ada di `state.decks`) — collection manual emang belum punya
    pause-switch (lihat catetan di `background.js`'s `getState()`). Baris
    "cards" juga dibedain: `"N cards · synced Xtime ago"` buat deck sync,
    `"N cards · manual"` buat collection manual (biar gak nampilin "not
    synced yet" yang nyesatin buat collection yang emang gak pernah sync).
    Tombol Delete tetep jalan buat kedua jenis — handler `removeDeck` di
    background.js ternyata udah generic (unlink kata + `deleteGroup`),
    gak butuh `msg.deckId` ada di `state.decks`.
  - **Bug lain yang ke-nemu pas testing**: `switchTab()` cuma manggil
    `render()` (yang ngebangun list ini) SEKALI pas page pertama kali
    dimuat — klik tab Settings belakangan gak pernah refresh list-nya sama
    sekali (beda sama tab lain yang semua punya re-render on-switch: Stats,
    Study, Words, Kanji, Graph). Jadi kalo user nambah collection dari tab
    Words dulu baru pindah ke Settings, panelnya nunjukin data BASI dari
    page-load, bukan collection yang baru dibikin. Ketauan pas Playwright
    test nunjukin `collection rows: []` padahal collection udah kesimpen di
    IndexedDB. Fix: tambah `if (tab === "settings") render();` di
    `switchTab()`, sama polanya kayak tab lain.
  - Sempet ada CSS layout bug juga: pensil awalnya ke-dorong jauh ke kanan
    (deket tombol Delete) bukan nempel di sebelah nama, gara-gara reuse class
    `.group-check-label` (`flex:1`) di dalem wrapper `display:flex` yang
    lebar penuh — jadinya nama div nge-grow ngisi semua ruang kosong. Fix:
    wrapper diganti `display:inline-flex` (nge-shrink ngikutin konten) +
    class `.group-check-label`-nya dilepas dari nama div.
  - Diverifikasi lewat Playwright: bikin collection manual baru lewat tab
    Words → pindah ke Settings → collection-nya muncul dengan bener (bukti
    fix bug `switchTab`) → klik pensil → input muncul → ganti nama → Save →
    nama ke-update di list, persist abis reload. Dicek juga tampilan dark
    mode-nya lewat screenshot, gak ada console error di semua langkah.
- [x] **Kanji card gak nampilin kata asalnya sendiri** — user komplain kata
      yang dari situ kanji-nya diklik gak muncul di list "words using this
      kanji" pas card kanji-nya dibuka.
  - Root cause di `openKanjiModal()` (word-editor.js): filter list-nya
    `(w.kanjiList || []).includes(k) && w.id !== editingId` — sengaja
    nge-exclude kata yang lagi dibuka di Word modal (`editingId`), niatnya
    kayaknya biar gak nampilin diri sendiri di list "other words". Tapi
    ternyata itu bikin kata ASAL-nya (yang kanji-nya diklik) selalu ilang
    dari list, padahal itu justru kata yang paling relevan buat muncul.
  - **Fix**: hapus exclusion `&& w.id !== editingId`-nya, list sekarang
    nampilin SEMUA kata yang pake kanji itu termasuk kata asalnya. Teks
    empty-state juga diubah dari "No other words use this kanji yet." jadi
    "No words use this kanji yet." (kata "other"-nya udah gak akurat lagi).
  - Diverifikasi lewat Playwright: bikin 2 kata satu collection yang share
    kanji sama (食べる & 食事) → buka 食べる di view mode → klik karakter 食
    → card kanji-nya nampilin KEDUANYA (termasuk 食べる, si kata asal) →
    gak ada console error.
- [x] **Kanji card bisa dibuka langsung dari flashcard popup** — sebelumnya
      kanji detail (on'yomi/kun'yomi, meaning/notes, kata lain yang pake
      kanji itu) cuma bisa diakses dari tab Words (options.html). User mau
      pas ketemu kanji asing di popup on-page, bisa langsung liat/kasih
      catetan tanpa pindah ke Kotoba Bank dulu.
  - Setiap karakter kanji di `.kanji` (word yang lagi ditampilin) sekarang
    dibungkus `<span class="k-char">` yang clickable (`content.js`,
    `appendKanjiText()` — reuse `extractKanjiList()` dari `core/kanji.js`
    persis kayak `renderKanjiInline()` di word-editor.js, cuma versi DOM
    manual karena appendFurigana juga manual appendChild, bukan innerHTML).
  - Klik kanji nge-swap isi card (bukan buka window/modal baru) — `.fc`
    (flashcard content) disembunyiin, `.kview` (kanji view) ditampilin,
    di dalem shadow DOM yang sama. Sengaja gak destroy state flashcard-nya
    (reveal/drag position/dll) karena cuma toggle `display`, bukan re-render
    dari awal — tombol "‹ Back to card" balikin tanpa reset apapun.
  - **Message baru** di background.js: `getKanjiInfo` (return kata-kata lain
    yang pake kanji itu + `kanjiMeta` yang udah kesimpen, reuse
    `getWordsByKanji`/`getKanjiMeta` yang udah ada di db.js) dan
    `saveKanjiMeta` (reuse `putKanjiMeta`). Content script gak bisa akses
    IndexedDB langsung (beda origin — kalo dibuka di sembarang web page,
    `indexedDB.open()` bakal ngebuka DB punya page itu, bukan punya
    extension), jadi emang harus lewat message ke background.js kayak
    semua akses data lain di content.js.
  - `core/kanji.js` ditambahin ke `content_scripts` di manifest.json (biar
    `extractKanjiList` bisa dipake content.js juga, bukan cuma
    background.js/migrate.js/halaman options).
  - `data/kanjidic.json` (readings on'yomi/kun'yomi, ~640KB) di-fetch lazy
    pas kanji pertama diklik (cached per page-load, sama pattern kayak
    `loadKanjidic()` di word-editor.js). **Gotcha yang ke-nemu pas testing**:
    fetch dari content script ke `chrome-extension://.../data/kanjidic.json`
    awalnya gagal ("Failed to fetch") — beda sama fetch dari halaman
    options.html (extension page) yang emang boleh akses resource extension
    bebas. Content script yang jalan di ORIGIN web page butuh entry
    `web_accessible_resources` di manifest.json biar boleh fetch file
    extension; ditambahin `{ "resources": ["data/kanjidic.json"], "matches":
    ["<all_urls>"] }`.
  - Related-words list-nya SENGAJA gak exclude kata asal (beda kasus sama
    bug yang barusan dibenerin di atas) — di sini emang dari awal query-nya
    `getWordsByKanji()` polos, gak ada `editingId` buat di-exclude.
  - Diverifikasi lewat Playwright: trigger card lewat `showNow`, klik
    karakter kanji-nya → view kanji kebuka nampilin on'yomi/kun'yomi bener
    + related words (termasuk kata asalnya sendiri) → isi meaning/notes →
    Save → indikator "Saved" muncul → Back → balik ke flashcard tanpa reset.
    Dicek juga di mode Tiered sama dark mode (screenshot), gak ada console
    error di semua langkah, dan data notes-nya persist ke test run berikutnya
    (bukti beneran kesimpen di IndexedDB, bukan cuma di memory).

## Next Version (post-MVP)

- [ ] Manual status override (tombol "mark as mastered" dkk, set `statusOverride: true`)
- [ ] Kolom tambahan: `tags`, `partOfSpeech` — field udah dialokasikan di
      schema (next_feature.md §3), belum ada UI buat isi/edit (`example` udah
      kelar, lihat "Manual add + word/kanji detail card" di atas)
- [ ] `manifest.json` — permission `unlimitedStorage` kalau ternyata dibutuhkan
      setelah data tumbuh
