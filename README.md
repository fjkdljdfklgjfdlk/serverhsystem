# Panel pengumuman Roblox Python

## Aplikasi yang Dikemas

- **macOS (Apple Silicon):** Buka `ServerHSystem.app`, yang sudah terinstal di `~/ServerHSystem`, atau gunakan `ServerHSystem-macOS-arm64.dmg` untuk menyalin aplikasi ke tempat lain.  Python dan Tk sudah termasuk.  Aplikasi Mac yang dikemas selalu membaca `.env` dan menyimpan `delivery-history.json` di `~/ServerHSystem`, termasuk saat diluncurkan dari Applications.
- **Windows (64-bit):** Buka `ServerHSystem.exe`. Python dan Tk sudah termasuk.  Simpan `.env` di samping EXE; riwayat pengiriman juga disimpan di sana.  Gunakan folder di mana akun Windows Anda dapat menulis file.  Salin `.env.example` ke `.env` dan isi secara lokal jika berpindah ke komputer lain.

Kue asli Anda disimpan di luar kedua biner dan gambar disk.  `.env` yang ada di `~/ServerHSystem` dipertahankan.  Riwayat pengiriman yang ada telah dipindahkan dari folder sumber ketika tujuan belum memiliki file riwayat.  Terus gunakan satu salinan aplikasi pada satu waktu.

Aplikasi Mac ditandatangani secara lokal ad-hoc, tanpa notarisasi Apple.  EXE Windows tidak ditandatangani dan **belum diuji waktu-jalan di Windows**.  Ini dirakit dengan runtime resmi Windows CPython 3.14.6, file resmi Tcl/Tk yang sesuai, dan bootloader GUI x64 pra-bangun dari PyInstaller.  Arsitektur PE-nya, subsistem GUI, checksum, versi bytecode Python, dan semua 972 entri arsipnya telah diverifikasi.  Aplikasi Mac lulus uji peluncuran paket dengan kedua bahasa antarmuka, log keluaran, dan sertifikat HTTPS yang dibundel.  DMG lulus `hdiutil verify`.  Validasi sumber memiliki 23 tes offline yang berhasil.  Pengiriman obrolan tetap eksperimental dan belum diverifikasi.

## Menjalankan dari sumber Python

Jalankan dengan **Python 3.10 atau lebih baru dengan Tkinter**.  Aplikasi ini menggunakan kontrol Tk/ttk bawaan default, tanpa tema kustom.  Tidak ada paket pip yang diperlukan:

```sh
python3 announcer.py
```

Ini membuka panel desktop.  Di Windows, `py announcer.py` juga berfungsi, atau klik dua kali `start_panel.pyw` ketika asosiasi file Python telah diinstal.  Simpan `panel.py` dan `announcer.py` bersama-sama.  Versi terminal sebelumnya tetap tersedia dengan `python3 announcer.py --cli`.

1. Batalkan sesi Roblox yang terpapar di **Pengaturan → Keamanan → Di mana Anda masuk**.  Keluar dari sesi tersebut, lalu masuk kembali.  Jangan pernah menggunakan kembali cookie yang diposting dalam obrolan.
2. Tempatkan cookie baru di `.env` di samping `announcer.py` (salin `.env.example` ke `.env` jika perlu), lalu klik **Connect / reload .env**.  Panel akan membacanya lagi setiap kali Anda terhubung.  Ini tidak membaca cookie browser atau mengirim cookie ke mana pun kecuali ke tiga host API Roblox yang digunakan dalam sumber.
3. Klik **English** atau **Bahasa Indonesia** di bagian atas.  Tombol-tombol ini mengubah label panel dan entri log keluaran baru.  Pengumuman dikirim persis seperti yang diketik; rincian kesalahan layanan mempertahankan teks aslinya.
4. Klik **Muat teman**, lalu tulis pesan Anda di kotak **Pengumuman**.
5. Klik **Pratinjau** untuk meninjau penerima dan pesan yang tepat di kotak **Output**.  Prabaca tidak mengirimkan pesan.
6. Pilih seorang teman dalam daftar dan klik **Kirim ke teman yang dipilih** untuk uji coba.  Periksa hasilnya di Roblox sebelum mencoba batch.
7. Klik **Kirim ke semua teman**, tinjau pratinjau dan konfirmasi dialog untuk mencoba batch.  **Berhenti** menghentikan periode menunggu atau berhenti setelah permintaan saat ini selesai.  Permintaan jaringan menggunakan batas waktu 30 detik per percobaan; penyegaran CSRF dapat memerlukan percobaan kedua.

Panel tetap responsif saat operasi jaringan berjalan.  Kotak outputnya mencakup detail penerima, pengakuan API, kesalahan, duplikat yang dilewati, pembatalan, dan jumlah hasil.  Bilah kemajuan menghitung penerima yang dicoba.  Hanya satu operasi yang berjalan pada satu waktu, dan pesan terkunci selama operasi berlangsung.

## Konfigurasi Cookie

Edit `.env` secara lokal:

```dotenv
ROBLOX_COOKIE="tempel_nilai_cookie_baru_anda_di_sini"
```

Gunakan hanya nilai cookie.  Sumber menjalankan lokasi `.env` relatif terhadap skrip; aplikasi yang dikemas menggunakan lokasi yang dijelaskan di atas.  Variabel lingkungan proses `ROBLOX_COOKIE` yang sudah ada dan tidak kosong memiliki prioritas lebih tinggi daripada `.env`.  Jika keduanya tidak menyediakan nilai, panel akan membuka dialog cookie yang tersembunyi (CLI menggunakan prompt terminal yang tersembunyi).  Nilai dibaca secara harfiah; perintah shell dan referensi variabel tidak pernah dievaluasi.  Tanda kutip tunggal, tanda kutip ganda, baris kosong, dan komentar didukung.

`.env` menyimpan cookie sebagai teks biasa.  Jaga kerahasiaannya; `.gitignore` mengecualikannya.  ZIP yang didistribusikan mencakup `.env.example` dan tidak pernah mengemas `.env` Anda yang sebenarnya.  Di macOS/Linux, `chmod 600 .env` membatasi akses file hanya untuk pengguna Anda.  Program ini tidak mencetak atau menulis cookie.

## Batasan kompatibilitas dan pengiriman

Ini adalah **klien API Chat situs web eksperimental**, bukan integrasi DM Open Cloud yang didukung Roblox.  Roblox menghentikan pesan **Kotak Masuk** antar pengguna pada 29 Oktober 2024.  Menu ini mencoba mengirim pesan **Chat** satu lawan satu biasa dari akun Anda; tidak dapat membuat pengumuman resmi sistem Roblox.

Layanan Chat platform situs web diidentifikasi yaitu dari percakapan yang digunakan dan tidak ada pesan langsung yang dikirim.
