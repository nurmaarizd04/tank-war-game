# 🪖 Tank Strike — Pertempuran Tank Dunia 3D

Game tank perang **3D** yang dimainkan di browser HP maupun laptop: **versus online bersama teman**
(semua lawan semua, hingga 10 pemain) atau latihan melawan komputer.
Dibuat dengan **TypeScript + Three.js + PeerJS + Vite**. Semua model tank, peta, efek, suara,
dan **musik latar orisinal** dibuat lewat kode — tanpa file gambar/audio berhak cipta.

## ✨ Fitur

- **Grafis 3D**: tank 3D (rantai bergerak, roda, turret, laras dengan hentakan), gedung beratap,
  pohon, batu, peti & tong yang bisa dihancurkan, bayangan, kilatan cahaya ledakan, asap & api 3D.
- **24 tank dari 14 negara** — 21 modern (M1A2 & **M1E3 Abrams**, Leopard 2A7 & **2A8**, **KF51 Panther**,
  T-90M, **T-14 Armata**, Challenger 2 & **3**, Leclerc & **Leclerc XLR**, Merkava Mk4 & **Mk4 Barak**,
  Type 99A, **Type 100**, K2 Black Panther, Type 10, C1 Ariete, Arjun, Altay, **Pindad Harimau**)
  dan 3 legenda Perang Dunia II (Tiger I, T-34-85, M4 Sherman), masing-masing dengan statistik berbeda.
  Tank generasi terbaru diberi lencana **BARU** di garasi.
- **Main bersama teman lewat internet** — buat room, bagikan kode 5 huruf / link, hingga 10 pemain
  saling lawan. Atur target hancurkan (5–20) & durasi (3–8 menit). Tank yang hancur muncul kembali
  dengan perisai sesaat. Ada papan peringkat, kill feed, dan papan skor akhir.
- **4 peta**: Padang Rumput, Gurun, Salju, dan Kota — masing-masing dengan warna tanah, langit,
  pohon, dan kepadatan rintangan berbeda. Dipilih di layar latihan, atau oleh host di lobi online.
- **Kamera dari belakang tank** yang ikut berputar mengikuti arah badan tank.
- **Latihan vs komputer**: AI yang mengejar, memutar, menghindari rintangan & membidik dengan prediksi;
  3 tingkat kesulitan dan gelombang musuh yang makin kuat.
- **Tank modern detail**: badan rendah dengan glacis miring, turret lebar bersudut, rantai dengan
  sprocket & idler, side skirt tebal, peluncur granat asap, senapan mesin jarak jauh (RWS), bidikan
  komandan & penembak, sistem pertahanan aktif (radar + peluncur pencegat), turret tanpa awak dengan
  tiang sensor (T-14, M1E3), keranjang turret berisi perlengkapan, lampu depan, dan pantulan logam realistis.
- **Suara kru** berbahasa Inggris gaya radio tank lewat interkom ("Up!", "Target destroyed!", "Bail out!"), memakai suara browser paling natural yang tersedia
  memakai suara bawaan browser; bisa dimatikan dengan tombol headset.
- **Musik latar orisinal** (versi menu & pertempuran) + efek suara; masing-masing bisa dimatikan.

## 🎮 Kontrol

| | HP | Laptop |
| --- | --- | --- |
| Bergerak | Geser sisi **kiri** layar (atas = maju, kiri/kanan = belok) | **W/S** maju/mundur, **A/D** belok (atau panah) |
| Membidik | Geser sisi **kanan** layar (menembak otomatis) | **Mouse** |
| Menembak | **Ketuk** sisi kanan (bidik otomatis ke musuh terdekat) | **Klik** / **Spasi** |
| Menu | Tombol ⏸ | **Esc** |

## 🚀 Menjalankan di komputer

```bash
npm install
npm run dev
```

## 🌐 Supaya teman-teman bisa ikut main (wajib di-online-kan)

Teman di tempat lain butuh **alamat game yang bisa dibuka dari internet**. Cara termudah (gratis):

1. Upload folder proyek ini ke GitHub.
2. Buka [vercel.com/new](https://vercel.com/new), impor repo tersebut — Vercel otomatis mendeteksi Vite
   (perintah build `npm run build`, folder `dist`).
3. Bagikan alamat yang didapat (misal `https://tank-strike.vercel.app`) ke teman.
4. Satu orang pilih **Main Bersama Teman → Buat Room**, lalu tekan tombol **bagikan** di lobi
   untuk mengirim link undangan (langsung berisi kode room) lewat WhatsApp.

Di HP, buka alamat tersebut lalu pilih **Tambahkan ke layar utama** agar terbuka layar penuh seperti aplikasi.

> Tes cepat di Wi-Fi yang sama tanpa deploy: jalankan `npm run dev -- --host`, lalu buka alamat
> **Network** yang muncul dari HP lain.

### Cara kerja online

Koneksi antar pemain memakai **WebRTC peer-to-peer** (lewat [PeerJS](https://peerjs.com)), jadi tidak
perlu server sendiri. Pembuat room (host) menjalankan simulasi pertempuran; pemain lain mengirim input
dan menerima keadaan permainan 20× per detik. Karena itu:

- Jika **host keluar**, room ditutup untuk semua pemain.
- Host sebaiknya memakai HP/laptop dengan sinyal paling stabil.
- Di sebagian kecil jaringan yang sangat ketat (misal Wi-Fi kantor tertentu), koneksi langsung bisa
  gagal — coba pakai data seluler.

## 🗂️ Struktur

```
src/
  data/tanks.ts      ← daftar tank & statistiknya (tambah tank baru di sini)
  data/flags.ts      ← bendera negara (SVG)
  data/maps.ts       ← tema peta: warna, langit, jumlah rintangan (tambah peta baru di sini)
  game/game.ts       ← simulasi: mode demo / latihan / host / pemain online, peluru, kerusakan, skor
  game/protocol.ts   ← format data online (snapshot & event)
  game/tank.ts       ← fisika tank
  game/ai.ts         ← AI musuh & tingkat kesulitan
  game/world.ts      ← peta (dibuat dari seed yang sama untuk semua pemain), tabrakan
  game/music.ts      ← musik latar orisinal (sequencer Web Audio)
  game/audio.ts      ← efek suara sintetis
  game/crew.ts       ← suara kru (Web Speech API) & daftar kalimatnya
  game/input.ts      ← joystick sentuh, keyboard, mouse
  net/session.ts     ← room online (PeerJS): buat, gabung, kirim input & snapshot
  render/models.ts   ← model 3D tank & tekstur lingkungan
  render/renderer.ts ← adegan 3D, kamera, partikel, minimap & label pemain
  render/preview.ts  ← pratinjau tank 3D di garasi
  ui/app.ts          ← menu, garasi, lobi, HUD, hasil pertandingan
```
