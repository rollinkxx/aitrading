# Audit Forensik AITrading

Tanggal audit: 2026-11-09

## Kesimpulan langsung

Aplikasi tidak memiliki kerusakan fatal pada build atau jalur data utama setelah perbaikan terakhir, tetapi audit menemukan satu masalah production yang material: Edge Function `market-collector` yang aktif berada pada version 7 dan berbeda dari source repository yang sudah menerapkan atomic persistence, lease fencing, deadline, serta validasi market-data yang lebih ketat. Masalah tersebut sudah diperbaiki dengan deployment version 8 ke Supabase production.

Engine sinyal saat ini adalah **heuristic trend-following**, bukan model probabilitas dan bukan strategi 3EMA formal. Ia memakai konfirmasi multi-timeframe 15M/1H/4H, EMA, RSI, MACD, volume ratio, dan spread. Secara rekayasa data, sistem sudah fail-closed untuk banyak kondisi invalid. Namun secara trading, bobot skor, threshold, floor risk, target 2.1R, dan label confidence belum dibuktikan lewat backtest out-of-sample yang memadai.

Bukti production yang tersedia sampai audit ini justru menunjukkan performa awal yang buruk dan belum layak disebut mempunyai edge: 30 outcome dalam tujuh hari terdiri dari 6 take-profit dan 24 stop-loss. Itu setara win rate 20% pada sampel kecil. Return snapshot yang tercatat berjumlah sekitar -14,83 poin persentase sebelum fee/slippage. Karena evaluator memakai snapshot price dan bukan replay intrabar, angka ini adalah sinyal peringatan, bukan estimasi performa final.

## Temuan production yang sudah diperbaiki

### 1. Drift source repository versus Edge Function live — severity tinggi

Repository sudah memakai RPC `persist_collector_batch`, heartbeat, deadline, dan fencing. Edge Function live version 7 masih memakai serangkaian REST upsert terpisah untuk markets, ticks, candles, indicators, signals, expiry, outcomes, dan collector run. Akibatnya, bila proses berhenti di tengah, database dapat berisi sebagian batch sementara status run belum merepresentasikan keseluruhan transaksi.

Perbaikan yang dilakukan:

- deploy `market-collector` ke Supabase version 8;
- source live sekarang memakai jalur `rpc/persist_collector_batch`;
- lease di-heartbeat sebelum persistence dan diverifikasi oleh RPC melalui fencing token;
- request database dan official API memiliki deadline bounded;
- source live diverifikasi ulang melalui `get_edge_function` setelah deployment.

### 2. Validasi order book live sebelumnya longgar — severity tinggi

Version 7 hanya memotong depth menjadi 30 level dan mengubah nilai menjadi number. Ia tidak memastikan semua level finite dan positif, urutan bid/ask benar, serta top of book tidak crossed sebelum depth masuk ke `liquidity()` dan memengaruhi skor.

Version 8 sekarang memakai `normalizeDepth` dan `validDepth`. Ticker yang masuk ke signal path juga diverifikasi melalui `validTicker`. Order book invalid atau crossed tidak menghasilkan sinyal.

### 3. Validasi timestamp candle tidak konsisten — severity sedang

Frontend menolak candle masa depan, sedangkan collector source sebelumnya hanya memfilter candle malformed dan menyerahkan timestamp masa depan kepada helper history. Version 8 sekarang menolak candle dengan timestamp lebih dari `now + 60 detik` sebelum history diproses. Ini menyamakan perilaku server dengan frontend dan mencegah future-data contamination.

### 4. UI sempat menampilkan level HOLD seolah-olah rencana transaksi — severity sedang

Engine mengisi stop-loss dan target untuk semua hasil terverifikasi, termasuk `HOLD`. Walaupun status database HOLD adalah informational dan tidak dievaluasi sebagai posisi aktif, detail UI tetap dapat menampilkan angka yang terlihat seperti instruksi entry/exit.

Source frontend sudah diperbaiki agar entry, stop-loss, target, dan risk/reward hanya ditampilkan untuk BUY atau SELL. Deployment Worker Cloudflare belum berhasil karena token yang tersedia mengarah ke account `4ee20403946ab8adb391cc1410c77e60`, sedangkan konfigurasi Worker menunjuk account `61b0828673501d7247e50a5c7c2a1cc8`. Build lokal lulus; patch tersimpan di repository dan perlu dirilis dengan kredensial account Worker yang benar.

## Audit logika engine sinyal

### Alur yang benar

1. Ticker harus fresh, positif, berurutan, dan last price berada di rentang 24H low-high.
2. Candle disortir, candle aktif dikeluarkan, dan history minimum diverifikasi.
3. History yang terlalu lama, memiliki duplikasi, atau gap di atas dua interval menghasilkan WAIT.
4. Order book harus ada dan valid.
5. Trend higher timeframe dihitung dari EMA 50 versus EMA 200 pada 1H dan EMA 50 versus EMA 150 pada 4H.
6. Momentum 15M memakai EMA 20/50, RSI, MACD, volume ratio, dan spread.
7. BUY hanya bila skor >=68, higher timeframe bullish, dan spread <=0,8%.
8. SELL hanya bila skor <=35, higher timeframe bearish, dan spread <=0,8%.
9. Sinyal BUY/SELL aktif selama 15 menit; HOLD/WAIT disimpan sebagai informational.

### Kelemahan trading yang masih ada

#### Confidence bukan probabilitas

Skor 0–100 adalah penjumlahan bobot buatan tangan. Tidak ada kalibrasi yang menghubungkan skor 80 dengan probabilitas profit 80%. UI menyebutnya skor heuristik, tetapi desain produk masih mudah dipersepsikan sebagai confidence prediktif. Nama yang lebih tepat adalah `signal_score`, kecuali nanti dikalibrasi dari dataset walk-forward.

#### Bobot dan threshold belum mempunyai dasar empiris

Bobot +16, +12, +10, +6, +5, +4 serta penalti -6 dan -10 tidak berasal dari optimasi yang didokumentasikan, uji sensitivitas, atau validasi out-of-sample. Threshold 68/35 dan spread 0,8% juga belum memiliki bukti bahwa keduanya optimal setelah fee, slippage, dan market regime diperhitungkan.

#### Ini bukan strategi 3EMA dan belum mendeteksi break/retest

Engine menggunakan EMA 20/50, EMA 50/200, dan EMA 50/150. Ia tidak menggunakan tiga EMA sebagai satu aturan crossover/alignment formal. Ia juga tidak mencari swing high/low, break of structure, retest, rejection candle, support/resistance, atau liquidity sweep. Karena itu engine bukan implementasi metode 3EMA Expert dan bukan implementasi break-and-retest.

#### Entry zone bukan trigger entry

`entryLow = last - 0,35 ATR` dan `entryHigh = last + 0,10 ATR` untuk BUY maupun SELL. Zona ini mengelilingi harga referensi dan tidak mensyaratkan harga benar-benar retrace ke zona, close kembali searah tren, atau menembus level tertentu. Secara semantik itu lebih dekat ke rentang toleransi harga saat sinyal dibuat, bukan aturan entry yang bisa direplay secara deterministik.

#### Risk/reward tetap, bukan target berbasis struktur

Risk memakai `max(1,8 ATR, 0,8% harga)`, target selalu 2,1 kali risk, dan stop selalu di harga saat ini ± risk. Tidak ada struktur swing, support/resistance, fee, slippage, gap, atau spread asimetris antara entry dan exit. Dengan demikian angka `1:2.1` adalah asumsi desain, bukan hasil validasi.

#### Outcome evaluator masih snapshot-sampled

Checker mengevaluasi harga snapshot setiap beberapa menit. Ia tidak menggunakan high/low intrabar untuk mengetahui apakah stop atau target disentuh lebih dahulu. Jika keduanya disentuh dalam satu interval, stop mendapat precedence. Ini konservatif tetapi bukan replay pasar yang sebenarnya. Return SELL juga memakai last price, bukan bid/ask yang realistis untuk menutup posisi short.

#### Duplikasi engine frontend dan server

`src/lib/strategy.ts` dan fungsi internal collector mengandung salinan logika indikator dan scoring. Keduanya saat ini hampir sama, tetapi struktur ini tetap rawan drift pada perubahan berikutnya. Akar perbaikan jangka panjang adalah memindahkan engine murni ke shared module yang dapat diuji dan dipakai oleh frontend serta Edge Function, atau menetapkan server sebagai satu-satunya sumber keputusan dan frontend hanya merender hasil server.

#### Gap tepat dua interval masih diterima

Validator menganggap gap `<= interval * 2` dapat diterima. Ini berarti satu candle yang hilang dapat lewat. Itu mungkin disengaja agar collector tahan terhadap satu bar yang hilang, tetapi bukan data kontinu sempurna. Untuk strategi indikator dan backtest, kebijakan ini harus eksplisit: reject semua gap, atau isi gap dengan aturan yang diaudit. Jangan membiarkan kebijakan ini diam-diam memengaruhi EMA/RSI.

## Bukti production yang sudah diperiksa

- Collector run terbaru sebelum deployment: 438 markets, 438 ticks, 1.920 candles, 8 signals, status completed.
- GET endpoint collector setelah version 8: HTTP 200.
- POST tanpa secret: HTTP 401.
- Hak akses RPC collector tetap service-role-only.
- Test lokal setelah patch: 78/78 lulus.
- TypeScript typecheck lulus.
- Production build lulus.
- Outcome 7 hari: 24 stop-loss dan 6 take-profit.
- Rata-rata return stop-loss: sekitar -1,921551%; total sekitar -46,117235%.
- Rata-rata return take-profit: sekitar +5,214025%; total sekitar +31,284147%.
- Total return snapshot: sekitar -14,833088% sebelum biaya.

Outcome tersebut bukan bukti bahwa setiap trade memakai ukuran posisi sama. Angka ini juga tidak cukup besar untuk mengestimasi Sharpe, expectancy stabil, maximum drawdown, atau edge yang tahan regime. Tetapi hasilnya cukup buruk untuk menolak klaim bahwa engine sudah terbukti efektif.

## Perbandingan dengan Cenli Yani

Konten profil TikTok yang diminta tidak seluruhnya dapat dibaca karena halaman profil TikTok mengembalikan halaman kosong pada browser sandbox. Karena itu tidak jujur bila menyatakan seluruh kontennya telah diaudit. Saya gunakan sumber publik yang dapat diverifikasi sebagai triangulasi.

Instagram publik Cenli Yani menampilkan bio “Author of the 3EMA Expert Book”, “Female Trader”, dan “Trading Analyst” [1]. Hasil publik lain mengaitkan peluncuran buku tersebut dengan Didimax dan judul 3EMA Expert [2]. Repost TikTok yang dapat dibaca menekankan proses lima tahun, kesiapan mental, dan bahwa trading bukan aktivitas yang boleh dilakukan sembarangan [3]. Sumber clip publik lain menampilkan tema pembahasan trading, strategi profesional, dan disiplin, tetapi tidak memberikan aturan entry-exit lengkap [4].

Jadi ringkasan yang dapat dipertanggungjawabkan adalah: pendekatan yang dipasarkan sebagai identitas Cenli Yani berpusat pada 3EMA/trend-following, disiplin, proses, kesiapan mental/modal, dan kemungkinan penggunaan konsep price action seperti break/retest atau swing points. Periode tiga EMA, definisi crossover/alignment, candle trigger, stop-loss, target, dan aturan invalidasi tidak dapat dipastikan dari sumber teks publik yang berhasil diakses. Jangan menganggap snippet promosi sebagai spesifikasi strategi formal.

### Mana yang lebih efektif?

Belum ada dasar ilmiah untuk menyatakan strategi Cenli Yani lebih efektif daripada AITrading, atau sebaliknya. Perbandingan yang valid harus memakai aturan yang ditulis lengkap, aset/venue yang sama, timeframe yang sama, fee dan slippage yang sama, periode out-of-sample yang sama, serta aturan eksekusi dan sizing yang sama.

Secara **konseptual**, metode 3EMA yang trend-following lebih sederhana, lebih mudah dijelaskan, dan lebih mudah di-backtest. AITrading lebih kaya secara engineering karena memiliki multi-timeframe, RSI, MACD, volume, spread, freshness checks, dan fail-closed behavior. Namun lebih banyak indikator tidak otomatis lebih efektif; tanpa validasi, itu hanya menambah degrees of freedom dan risiko overfitting.

Secara **empiris berdasarkan data AITrading yang tersedia**, AITrading belum menang: sampel outcome live menunjukkan rasio stop-loss yang jauh lebih tinggi daripada take-profit dan return snapshot negatif. Untuk Cenli Yani, data publik yang tersedia tidak berisi trade log terverifikasi atau backtest dengan definisi lengkap. Kesimpulan profesional saat ini adalah: **AITrading belum terbukti efektif, sedangkan efektivitas strategi Cenli Yani belum dapat diverifikasi; tidak boleh memilih pemenang dari popularitas atau jumlah followers.**

## Prioritas perbaikan metodologi

1. Jadikan server sebagai single source of truth untuk signal engine, atau ekstrak satu shared engine agar frontend dan server tidak dapat drift.
2. Ganti nama `confidence` menjadi `score` sampai ada kalibrasi probabilitas.
3. Pisahkan state `HOLD` dari level transaksi; hanya BUY/SELL yang boleh memiliki entry, stop, target, dan status active.
4. Definisikan trigger entry yang dapat direplay, misalnya close setelah retest, bukan sekadar rentang sekitar last price.
5. Tambahkan fee, spread bid/ask, slippage, dan latency ke evaluator.
6. Simpan MFE/MAE dan replay high/low candle untuk outcome, bukan hanya snapshot last price.
7. Jalankan backtest walk-forward per regime dan per kelompok likuiditas. Pisahkan development, validation, dan untouched test period.
8. Lakukan ablation study: baseline 3EMA, engine sekarang, engine tanpa RSI, tanpa MACD, tanpa volume, dan kombinasi yang ditetapkan sebelum melihat hasil.
9. Kalibrasikan threshold berdasarkan expectancy net biaya, bukan win-rate semata.
10. Rilis patch UI Cloudflare setelah token account `61b0828673501d7247e50a5c7c2a1cc8` tersedia atau konektor Cloudflare yang berwenang pada account tersebut diaktifkan.

## References

[1]: https://www.instagram.com/cenli_yani/?hl=en "Profil Instagram Cenli Yani"
[2]: https://www.youtube.com/watch?v=KNp--EAd1R4 "Peluncuran buku 3EMA Expert oleh Cenli Yani di Didimax"
[3]: https://www.tiktok.com/@damiaupj01q/video/7703340714389818645 "Repost TikTok tentang proses dan kesiapan trading"
[4]: https://www.facebook.com/61595427368827/videos/cenliyani_tk-duniatrading/28969670302684237/ "Kumpulan clip publik bertema Cenli Yani dan trading"
