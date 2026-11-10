# Audit Forensik Manajemen Risiko AITrading

Tanggal: 2026-11-10

## Ringkasan eksekutif

Audit menemukan bahwa AITrading **belum memiliki manajemen risiko portofolio** dalam arti profesional. Aplikasi saat ini menghitung level stop-loss/target untuk sinyal, tetapi belum menghitung ukuran posisi, nominal risiko per trade, risiko terhadap equity, exposure simultan, korelasi pair, biaya transaksi, slippage, atau batas kerugian harian.

Level stop-loss awal menggunakan:

```text
risk = max(1,8 × ATR(15M), 0,8% × reference_price)
BUY  stop = reference - risk
SELL stop = reference + risk
BUY  target = reference + 2,1 × risk
SELL target = reference - 2,1 × risk
```

Secara aritmetika, jarak target terhadap reference memang konsisten 2,1R. Namun itu bukan bukti bahwa strategi memiliki expectancy positif. Risk/reward adalah desain geometris, bukan hasil aktual setelah fee, spread, slippage, dan gap.

## Temuan yang sudah diperbaiki pada source

### 1. HOLD sebelumnya tetap membawa level risiko — severity sedang

Sebelum patch, `buildSignal()` menghitung stop-loss dan target sebelum mengetahui bahwa hasil akhir adalah HOLD. Akibatnya seluruh 948 sinyal HOLD production dalam tujuh hari memiliki entry, stop, target, dan `risk_reward=2.1`, walaupun statusnya informational dan bukan setup transaksi.

Perbaikan:

- HOLD sekarang mengembalikan level transaksi `0` secara internal;
- persistence mengubah angka nol menjadi `NULL`;
- UI menampilkan teks informatif:
  - Entry zone: **Menunggu setup**
  - Stop loss: **Tidak tersedia**
  - Target: **Tidak tersedia**
  - Risk/reward: `—`

Catatan: baris HOLD lama di database masih menyimpan level historis. Itu tidak lagi ditampilkan sebagai setup oleh UI dan tidak pernah diproses sebagai posisi aktif, tetapi normalisasi data lama tetap direkomendasikan.

### 2. Risiko ATR ekstrem dapat menghasilkan stop BUY non-positif — severity tinggi

Dengan formula lama, apabila `1,8 × ATR >= reference_price`, stop BUY dapat menjadi nol atau negatif. Database memiliki invariant stop positif untuk sinyal directional. Karena persistence atomic dilakukan dalam satu batch, satu level invalid berpotensi menggagalkan persistence seluruh batch collector, bukan hanya membatalkan satu sinyal.

Perbaikan source:

- signal actionable dengan ATR non-finite atau non-positive dibatalkan;
- signal dengan `risk >= 95% reference_price` diubah menjadi HOLD;
- stop dan target diverifikasi finite dan positif sebelum dikembalikan;
- regression test ditambahkan untuk ATR ekstrem.

### 3. Entry zone SELL sebelumnya tidak directional — severity sedang

Formula lama sama untuk BUY dan SELL:

```text
entry_low  = reference - 0,35 ATR
entry_high = reference + 0,10 ATR
```

Untuk SELL, ini memberi ruang pullback yang lebih besar di sisi bawah, padahal secara logika retracement short biasanya berada di atas reference. Source sekarang membalik asimetri tersebut untuk SELL:

```text
SELL entry_low  = reference - 0,10 ATR
SELL entry_high = reference + 0,35 ATR
```

Target dan stop tetap anchored ke reference. Karena itu R:R yang ditampilkan masih merupakan R:R terhadap reference, bukan R:R terhadap setiap titik dalam entry zone.

## Temuan risiko yang belum selesai

### A. Tidak ada position sizing — severity kritis secara produk

Aplikasi tidak mengetahui equity, modal, persentase risiko, nilai tick, atau quantity. Stop-loss hanya level harga. Pengguna tidak diberi jawaban atas pertanyaan inti: “Jika stop terkena, berapa rupiah yang hilang?”

Implementasi yang diperlukan:

```text
risk_budget = equity × risk_percent
stop_distance = abs(entry - stop)
position_size = risk_budget / stop_distance
```

Rumus harus disesuaikan dengan fee, min-notional, precision, dan aturan venue. Sebelum fitur ini ada, AITrading lebih tepat disebut signal engine, bukan risk-management engine.

### B. Stop-loss tidak memperhitungkan bid/ask, fee, dan slippage — severity tinggi

Reference menggunakan last price, sedangkan entry BUY secara realistis terjadi dekat ask dan exit stop BUY dekat bid. Untuk SELL, arah tersebut terbalik. Evaluator juga memakai `last`, bukan sisi order book yang relevan. Akibatnya return dan jarak risiko dapat terlihat lebih baik daripada kondisi eksekusi.

Minimum perbaikan:

- BUY entry/exit memakai ask/bid yang tepat;
- SELL entry/exit memakai bid/ask yang tepat;
- fee maker/taker dikurangkan dari return;
- slippage konservatif dikurangkan dari entry dan exit;
- spread pada saat sinyal disimpan sebagai bagian dari audit record.

### C. Risk/reward tidak sama dengan realized R:R — severity tinggi

`risk_reward=2.1` hanya benar bila entry terjadi tepat di `reference_price`. Bila pengguna masuk di `entry_high` atau `entry_low`, jarak stop dan target berubah, sementara database tetap menyimpan 2,1. UI perlu menyebutnya sebagai `planned R:R at reference`, atau menghitung R:R pada harga entry yang dipilih.

### D. Tidak ada minimum tick/price precision — severity sedang

Level seperti `718.1142857142858` atau `621.66` dapat valid secara matematika tetapi tidak selalu valid terhadap increment harga atau precision venue. Untuk signal-only masih dapat ditampilkan sebagai estimasi, tetapi sebelum ada eksekusi atau simulasi realistis, level perlu dinormalisasi ke precision yang berlaku dan rounding harus konservatif:

- BUY stop dibulatkan ke bawah;
- BUY target dibulatkan ke atas;
- SELL stop dibulatkan ke atas;
- SELL target dibulatkan ke bawah.

### E. Stop tidak berbasis struktur pasar — severity sedang

Stop hanya berbasis ATR dan floor 0,8%. Ia tidak memakai swing low/high, support/resistance, volatility regime, atau invalidation structure. Pada market yang memiliki wick panjang, ATR stop dapat terlalu jauh; pada market yang tenang, floor 0,8% dapat terlalu jauh atau terlalu dekat relatif terhadap spread dan noise.

### F. Outcome evaluator masih snapshot-sampled — severity tinggi

`signal-checker` memeriksa `last` secara berkala. Ia tidak mereplay high/low candle atau tick path untuk mengetahui urutan stop dan target. Jika satu interval menyentuh stop dan target sekaligus, stop-loss mendapat precedence. Ini konservatif, tetapi belum mewakili eksekusi aktual.

Evaluator juga tidak memasukkan fee/slippage dan belum menyimpan MFE/MAE yang benar-benar dihitung dari price path. Karena itu hasil `return_percentage` tidak boleh dibaca sebagai net P&L.

### G. Tidak ada portfolio-level risk controls — severity kritis secara produk

Belum ada:

- batas posisi simultan;
- batas exposure per quote/base asset;
- batas risiko kumulatif pair berkorelasi;
- daily loss limit;
- cooldown setelah stop-loss beruntun;
- batas jumlah sinyal directional per market;
- filter spread/volatility yang dikaitkan dengan nominal risiko;
- kill switch berbasis kualitas data atau kegagalan evaluator.

### H. Short SELL belum memodelkan borrow/availability

SELL adalah analisis arah bearish, bukan bukti bahwa pengguna dapat melakukan short di venue. UI dan dokumentasi harus tetap menyebutnya sebagai bearish signal, bukan instruksi short execution, kecuali instrumen dan mekanisme borrow benar-benar tersedia.

## Bukti production yang diperiksa

- Dalam tujuh hari terakhir terdapat 181 BUY dan 1.073 SELL directional dengan level yang lolos invariant arah database.
- Tidak ditemukan `rr_mismatch` pada sampel production: jarak target/reference terhadap jarak stop/reference konsisten 2,1.
- Stop distance BUY production: minimum 0,8%, maksimum 10,6286%, rata-rata 3,3711%.
- Stop distance SELL production: minimum 0,8%, maksimum 18,9097%, rata-rata 2,3347%.
- Dua sinyal aktif terbaru sama-sama memiliki level positif dan arah yang benar, tetapi precision harga belum dinormalisasi.
- 948 HOLD production masih menyimpan level risiko historis; UI patch menyembunyikannya dan source baru tidak lagi membuat level tersebut untuk HOLD.

## Prioritas implementasi berikutnya

1. Selesaikan normalisasi baris HOLD/WAIT lama menjadi `NULL` pada entry/stop/target/R:R.
2. Tambahkan risk guard server dan deploy Edge Function baru; frontend sudah diperbarui dan test lulus.
3. Tambahkan price precision serta bid/ask-aware risk calculation.
4. Tambahkan fee dan slippage ke outcome evaluator.
5. Tambahkan position sizing berbasis risk budget, tetapi tetap non-executing.
6. Tambahkan MFE/MAE dari replay OHLC/tick dan ganti label `snapshot_sampled` menjadi metrik yang tidak disalahartikan.
7. Tambahkan portfolio controls sebelum aplikasi pernah digunakan sebagai dasar keputusan dengan modal nyata.

## Status verifikasi patch

- Test sebelumnya: 78/78 lulus.
- Regression test baru mencakup HOLD tanpa level, SELL entry zone directional, dan ATR ekstrem.
- Typecheck dan build harus dijalankan sebelum deployment backend berikutnya.
