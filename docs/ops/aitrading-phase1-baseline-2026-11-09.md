# AITrading — Baseline Tahap 1

**Tanggal pengukuran:** 9 November 2026, sekitar 12:01 WIB (05:01 UTC)
**Tujuan:** mencatat kondisi sebelum implementasi perubahan freshness, retensi, evaluasi outcome, atau endpoint.
**Mode audit:** read-only untuk Supabase; tidak ada secret yang dibaca dan tidak ada perubahan produksi.

## Baseline repository dan test

- Repository: `rollinkxx/aitrading`.
- Revision dasar: `c59daf6` (`Fix initial lease claims and stale run cleanup`).
- Branch kerja lokal: `feature/phase1-test-baseline`.
- Runtime yang digunakan: Node.js `v22.23.4`, npm `10.9.9`.
- Sebelum perubahan Tahap 1, `npm test` menjalankan **45 test, 45 lulus, 0 gagal**.
- Suite memakai Node test runner dengan TypeScript type stripping dari `package.json`; tidak ada dependency test baru.

Cakupan test yang sudah ada meliputi strategi dan RSI, adapter Indodax, batas proxy, candle-history, pagination, outcome idempotency, penyimpanan lokal, dan beberapa kontrak migrasi. Tahap 1 menambah test untuk batas timestamp detik/milidetik dan umur harga, input harga/outcome malformed, prioritas stop-loss ketika kedua batas terpenuhi, candle yang tidak berurutan dan gap tepat dua interval, timestamp candle duplikat dan konfigurasi history invalid, konfigurasi pagination invalid, serta outcome tanpa `signal_id`.

## Baseline Supabase

Snapshot database diambil pada `2026-11-09 05:01:29 UTC`:

| Tabel/indikator | Nilai |
|---|---:|
| `markets` | 438 baris |
| `market_ticks` | 228.636 baris |
| `candles` | 5.821 baris |
| `indicators` | 1.910 baris |
| `signals` | 1.562 baris |
| `signal_outcomes` | 21 baris |
| `collector_runs` | 524 baris |
| Snapshot harga terakhir | `validated`, diterima 05:00:02.897 UTC; timestamp sumber 05:00:01 UTC |
| Collector terakhir | `completed`, 05:00:00.945–05:00:15.218 UTC; 438 market/tick, 1.920 candle upsert, 8 sinyal |

Jadwal cron aktif saat baseline diambil:

| Job ID | Jadwal | Makna |
|---|---|---|
| 4 | `* * * * *` | checker setiap menit |
| 5 | `*/5 * * * *` | collector penuh setiap lima menit |

Ukuran fisik `market_ticks` dari statistik PostgreSQL sekitar 63.193.088 byte (kurang lebih 60,3 MiB, termasuk indeks) saat pengukuran sekitar 12:00 WIB. Ini adalah snapshot ukuran, bukan proyeksi biaya atau kapasitas.

## Baseline log Edge Function

Rentang agregasi log: `2026-11-08 04:58 UTC` sampai `2026-11-09 04:58 UTC`.

| Fungsi / metode | HTTP | Request | p95 durasi | Maksimum |
|---|---:|---:|---:|---:|
| `market-collector` GET | 200 | 167 | 3.457 ms | 6.311 ms |
| `market-collector` POST | 200 | 285 | 14.758 ms | 17.900 ms |
| `market-collector` POST | 401 | 4 | 72 ms | 72 ms |
| `market-collector` POST | 500 | 1 | 16.280 ms | 16.280 ms |
| `signal-checker` POST | 200 | 1.413 | 2.667 ms | 4.886 ms |
| `signal-checker` POST | 401 | 1 | 964 ms | 964 ms |

Satu HTTP 500 collector tercatat pada `2026-11-09 04:15:16 UTC` dan memiliki event error runtime yang berkorelasi. Penyebabnya **belum ditetapkan** dalam Tahap 1; jangan menganggapnya sudah diperbaiki. Request 401 tercatat terpisah dan ditolak oleh autentikasi fungsi.

Keberhasilan pada riwayat `pg_cron` hanya digunakan sebagai bukti status job scheduler. Status HTTP Edge Function dan ledger `collector_runs` dicatat terpisah, karena enqueue job tidak dengan sendirinya membuktikan fungsi tujuan berhasil.

## Perintah verifikasi

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Semua perintah dijalankan dari root repository. Catat output aktual hasil verifikasi pada ringkasan perubahan Tahap 1.

## Batas baseline

- Data operasional merupakan snapshot pada waktu di atas; metrik berubah saat cron terus berjalan.
- Baseline ini tidak membaca atau menyimpan nilai secret, data pengguna, maupun isi header request.
- Tahap ini menambah unit-test untuk helper yang dapat dijalankan lokal tanpa koneksi jaringan atau database.
- Belum ada replay seluruh migrasi pada PostgreSQL bersih, integration test untuk autentikasi/lease collector, atau E2E otomatis race frontend; hal tersebut tetap di luar cakupan Tahap 1.
- Baseline dan test ini tidak mengubah jadwal cron, schema, retensi data, endpoint produksi, atau perilaku Edge Function.
