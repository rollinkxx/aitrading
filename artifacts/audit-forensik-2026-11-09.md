# Audit Forensik AITrading — 9 November 2026

## Ringkasan eksekutif

Audit lintas frontend, adapter data pasar, strategi, Supabase Edge Functions, migration/RLS, konfigurasi Worker, serta test suite menemukan satu blocker reproduktibilitas P1 dan sejumlah risiko P2/P3. Source migration untuk `collector_runs` hilang dari repository walaupun migration `20261107090437_background_collector` tercatat applied di project Supabase produksi. Migration berikutnya membuat index dan mengubah policy pada tabel itu, sehingga database kosong yang dibangun hanya dari SQL yang ada di repository tidak dapat direproduksi secara benar.

Source migration tersebut telah dipulihkan sebagai migration historis yang *direkonstruksi dari definisi tabel produksi, call sites, migration ledger, dan pemakaian index selanjutnya*. File ini tidak diklaim sebagai byte-for-byte salinan SQL historis asli. SQL membuat kolom dan constraint yang digunakan collector, mengaktifkan RLS, dan membatasi privilege tabel ke `service_role`. Production tidak diberi migration baru: versi yang sama sudah tercatat applied dan tabel aktif beserta data historisnya tetap ada.

## Cakupan dan bukti

Area yang ditinjau meliputi `src/App.tsx`, adapter di `src/lib/indodax.ts`, strategi pada `src/lib/strategy.ts` dan collector server, `supabase/functions/indodax-proxy`, `market-collector`, helper bersama, migration SQL, `cloudflare/wrangler.jsonc`, Worker wrapper, dokumentasi dan test. Pembacaan produksi dilakukan terhadap project Supabase `aitrading` yang cocok dengan host dalam konfigurasi, serta endpoint Worker utama `https://aitrading-app.witty-larch.workers.dev/` yang sebelumnya dipilih pengguna.

Bukti operasional produksi: Supabase project berstatus `ACTIVE_HEALTHY`; ledger memuat seluruh migration hingga `20261108020253`; tabel `collector_runs` ada dengan 412 baris, `run_key` unik, status check, RLS aktif, serta index run key dan started time; tabel inti berisi 438 market, 180.456 tick, 5.113 candle, 1.490 indicator, 1.228 signal, dan 9 outcome pada saat inspeksi. Edge Functions `indodax-proxy`, `market-collector`, dan `signal-checker` aktif. Tidak ada DDL destruktif yang dijalankan.

## Temuan dan tindakan

### P1 — migration source `collector_runs` hilang

- **Akar masalah:** repository tidak memuat file `20261107090437_background_collector.sql`; migration sesudahnya memakai `collector_runs`.
- **Dampak:** setup database kosong dari SQL repository gagal pada index `collector_runs_started`, dan kelengkapan schema tidak dapat direproduksi dari Git.
- **Tindakan:** migration historis dipulihkan/re-konstruksi pada versi yang tercatat, dengan primary key UUID, unique non-null `run_key`, waktu/status/counter, kolom diagnostik, RLS, serta akses hanya untuk `service_role`. Regression test memastikan definisi ada sebelum migration index dan error detail tidak dibuka ke role publik.
- **Status:** source sudah tersedia di branch kerja dan harus masuk rilis Git. **Replay seluruh migration terhadap PostgreSQL kosong belum dijalankan**, sehingga parser/runtime migration penuh tetap menjadi gap verifikasi.

### P2 — hasil sinkronisasi directory dapat tertimpa respons usang

`syncDirectory` memulai dua GET paralel dan sebelumnya tidak mengidentifikasi generasi request. Respons lambat dapat menimpa hasil lebih baru. Ditambahkan request-generation guard agar respons/exception dari request lama diabaikan.

### P2 — localStorage dapat menjatuhkan UI atau memuat bentuk data salah

State awal watchlist hanya menangkap JSON syntax error, bukan bentuk JSON valid yang salah; akses storage juga dapat melempar `SecurityError`/`QuotaExceededError`. Ditambahkan helper storage best-effort, fallback in-memory/default, validasi ID pair, deduplikasi, dan regression tests untuk bentuk rusak maupun storage terblokir.

### P2 — request adapter dapat menggantung dan parser depth menerima level invalid

Adapter sebelumnya tidak menetapkan timeout/retry dan depth parser dapat menghasilkan `NaN`. Kini request GET diberi batas 12 detik serta satu retry terbatas untuk jaringan/429/5xx; status non-retryable tidak dicoba ulang. Level depth malformed/non-finite/non-positive difilter. Timeframe candle dan batas bar disamakan dengan proxy (`15`, `60`, `240`; maksimum 300).

### P2 — RSI pada harga konstan salah diklasifikasikan overbought

Jika semua perubahan close nol, `avgGain === avgLoss === 0` sebelumnya menghasilkan RSI 100. Frontend dan collector server kini menangani kondisi flat sebagai RSI netral 50; kasus murni naik/turun tetap 100/0. Regression test dikonfirmasi gagal sebelum perubahan dan lulus sesudahnya.

### P2 — batas body proxy diterapkan setelah buffering seluruh respons

Limit 2 MB sebelumnya baru dicek sesudah `response.text()`, sehingga tidak membatasi alokasi body. Proxy sekarang memeriksa `Content-Length` jika tersedia dan membaca stream secara bertahap, membatalkan ketika byte kumulatif melewati 2 MB. Util stream memiliki test batas byte dan UTF-8.

### P3 — semantik aksesibilitas kontrol

Search field kini memiliki `aria-label`; tombol navigasi halaman aktif mengumumkan `aria-current="page"`. Validasi screen-reader/manual assistive technology belum dilakukan.

## Hasil verifikasi sesudah perubahan

- `npm ci`: selesai dari lockfile; audit install melaporkan **0 vulnerabilities**.
- `npm test`: **39/39 lulus**, termasuk regression test untuk migration, localStorage, adapter, body streaming, RSI, dan test lama.
- `npm run typecheck`: lulus.
- `npm run build`: lulus; Vite membangun HTML, CSS, dan JS produksi.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `git diff --check`: lulus.
- Wrangler dry-run: membaca **5 asset** dari `dist` dan mengonfirmasi binding `ASSETS` tanpa deploy dalam tahap dry-run.
- Browser preview hasil build: halaman memperoleh ticker Indodax live; semua navigasi Home/Markets/Signals/Watchlist/Settings bekerja, pencarian BTCIDR berfungsi, status `aria-current` aktif tepat, dan tidak ada exception JavaScript saat interaksi.
- Supabase `indodax-proxy` versi **5** aktif dengan `verify_jwt=false` (kontrak publik market-data dipertahankan). Setelah bounded-stream patch dirilis, `/api/pairs`, `/api/ticker/btcidr`, `/api/depth/btcidr`, dan request history valid menghasilkan HTTP 200; route di luar allowlist menghasilkan HTTP 404.
- Setelah dry-run, frontend benar-benar dirilis ke Cloudflare Worker `aitrading-app`: version ID final `b661e7c5-d6f0-4f60-af35-fb6ff83f82d2`; entry HTML dan bundle JS terbaru HTTP 200 dan bundle memuat label skor heuristik serta atribut aksesibilitas yang diperbaiki.
- Supabase `market-collector` benar-benar dirilis ke versi **6** dengan `verify_jwt=false` dipertahankan; GET snapshot tetap bekerja, POST tanpa `x-collector-secret` tetap mendapat **401**, dan collector terjadwal menyelesaikan run pascarilis: 438 market/tick, 1.920 candle, 8 signal, status `completed`.
- Smoke test browser production setelah masa loading awal menampilkan harga langsung, lima tab bernavigasi, pencarian BTCIDR berhasil, browser `fetch()` ticker/depth mendapat HTTP 200 dan JSON, tanpa exception; refresh snapshot menampilkan collector fresh.

## Risiko dan rekomendasi tersisa

1. **Pemulihan collector gagal (P2):** klaim run `run_key` bersifat insert-ignore. Jika collector gagal setelah klaim dibuat atau proses mati, retry pada jendela lima menit yang sama dilewati. Rekomendasi: lease/reclaim atomik untuk status failed/stale dan pemulihan run yang tertinggal `running`; uji konkurensi supaya tidak ada dua collector bersamaan.
2. **Outcome stop/target adalah snapshot-sampled (P2):** evaluasi harga polling dapat melewatkan sentuhan level di antara pemeriksaan. Jangan menafsirkan outcome sebagai rekonstruksi eksekusi intraperiode atau backtest; bila metrik tersebut diperlukan, evaluasi high/low candle sejak poll terakhir dengan aturan konservatif saat stop dan target sama-sama tersentuh.
3. **Skor bukan probabilitas (P2):** confidence 0–100 adalah skor heuristik berbobot, tidak dikalibrasi out-of-sample. UI sudah menyebutnya “skor”; dokumentasi dan komunikasi produk tidak boleh mengartikan angka itu sebagai peluang profit tanpa kalibrasi, sampel memadai, fee, slippage, dan evaluasi drift.
4. **Cron portability dan duplikasi job (P2):** URL project tertanam pada dua migration cron; migration hanya menghapus satu job bernama sama. Sebelum menggunakan project baru, parameterkan URL per environment dan pastikan tepat satu job aktif per nama. Perilaku cron di project baru belum diuji.
5. **Kapasitas snapshot (P2, risiko skala):** collector/snapshot membatasi markets/ticks hingga 1.000 dan checker membaca maksimal 500 sinyal aktif. Saat ini basis data berisi 438 market; paginasi harus ditambah sebelum kapasitas mendekati batas.
6. **Pengujian integrasi (P2):** belum ada replay migration pada database PostgreSQL kosong, integration test auth/reclaim collector, E2E otomatis race refresh, atau uji header/cache Worker di test suite. Browser smoke manual lokal dan test helper telah berjalan, namun bukan pengganti semua integration tests.
7. **Jangan aktifkan auto-trading berdasarkan hasil audit ini:** aplikasi sengaja signal-only; audit tidak memvalidasi eksekusi order privat, backtest berbiaya transaksi, keamanan kredensial bursa, atau sistem kill-switch.

## Batas audit

Tidak dilakukan migrasi data produksi, perubahan schedule/secret, ataupun aktivasi order. Audit production menginspeksi metadata dan data operasional agregat seperlunya; tidak membaca nilai secret. Tidak dilakukan audit formal semua dependency/transitive attack surface selain `npm audit`, penetration test, atau penilaian finansial/backtest. Perubahan UI dan library yang telah diuji baru setara klaim release setelah commit dan Worker production menyajikan bundle baru.
