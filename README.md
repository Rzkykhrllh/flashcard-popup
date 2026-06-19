# Nihongo Popup 🔴

Flashcard bahasa Jepang dari **Google Sheet kamu sendiri**, yang muncul tiba-tiba
sambil kamu kerja. Kanji muncul → kamu coba inget artinya → buka jawaban →
nilai sendiri (**Tau / Lupa**). Buat ngegangguin diri sendiri biar vocab nempel.

Ini MVP v1, dibikin buat dipakai sendiri dulu.

---

## Cara pasang (Load unpacked)

1. Unzip folder ini ke tempat yang permanen (jangan di Downloads yang sering dibersihin).
2. Buka Chrome → `chrome://extensions`.
3. Nyalain **Developer mode** (toggle kanan atas).
4. Klik **Load unpacked** → pilih folder `nihongo-popup` ini.
5. Pin ikonnya biar gampang diakses (ikon puzzle → pin).

## Cara siapin Google Sheet

1. Buka sheet vocab kamu. Pastikan tiap tab punya kolom yang kira-kira gini:

   | Kanji / Kata | Hiragana | Arti | Notes |
   |---|---|---|---|

   (Urutan/penamaan kolom fleksibel — dia nyari header yang mirip, dan kalau nggak
   ketemu, ambil 4 kolom pertama. Kolom lain seperti tanggal diabaikan.)

2. Share → **General access** → **Anyone with the link** → **Viewer**.
   Ini wajib: tanpa ini, extension nggak bisa baca sheet-nya (dia nggak pakai login).

## Cara pakai

1. Klik ikon extension → **Pengaturan & deck**.
2. **Tambah deck:** buka tab sheet yang mau dipakai, copy URL dari address bar
   (yang ada `#gid=…`), tempel, kasih nama, **Tambah & sync**.
   → Tiap tab = satu deck. Tambah sebanyak yang kamu mau.
3. Atur **frekuensi** (default tiap 15 menit) dan perilaku (skip fullscreen, skip pas ngetik).
4. Udah. Kartu bakal muncul sendiri di pojok kanan bawah halaman yang lagi kamu buka.
   - **Munculin sekarang** & **Sync** juga ada di popup toolbar.

Sync itu **manual / sekali klik** — bukan real-time. Klik "Sync semua" tiap kamu
nambah kata baru di sheet.

---

## Keputusan teknis yang diambil (biar kamu nggak bingung)

- **Merge, bukan replace.** Tiap kartu dikasih key dari `kanji|hiragana`. Pas sync:
  kartu lama → teksnya diperbarui, **progress-nya disimpan**; kartu baru → ditambah;
  kartu yang udah ada tapi nggak ada di sheet → **dibiarkan** (nggak dihapus).
- **Parser CSV beneran (PapaParse).** Bukan `split(",")` — soalnya isi sel kamu ada
  yang ada komanya (mis. "Target, Scope"). Itu bakal kacau kalau pakai split biasa.
- **Data lokal semua.** Disimpan di `chrome.storage.local`. Nggak ada server,
  nggak ada data yang dikirim ke mana-mana.
- **Recall = flip + self-grade** dulu (ketik jawaban ditunda ke v2).

## Struktur kode

```
manifest.json     izin + pendaftaran
background.js     service worker: sync (fetch CSV + merge), alarm, pilih kartu
content.js        overlay flashcard di halaman (Shadow DOM, self-contained CSS)
popup.html/js/css toolbar: quiz sekarang / sync / buka pengaturan
options.html/js/css  kelola deck + atur frekuensi
lib/papaparse.min.js parser CSV
```

Sumber data sengaja dipisah dari penyimpanan kartu — jadi nanti gampang nambah
"adapter" lain (upload CSV, dll) tanpa ngerombak.

## Roadmap v2 (kalau habit-nya nyangkut)

- Mode ketik jawaban pakai **WanaKana** (romaji → otomatis jadi kana, tanpa ganti IME).
- Penjadwalan **FSRS** beneran (sekarang baru bobot ringan: kartu baru & sering-lupa lebih sering muncul).
- Mode belajar (lihat kartu baru tanpa dites).
- Statistik: berapa kartu dikuasai, streak, dll.
