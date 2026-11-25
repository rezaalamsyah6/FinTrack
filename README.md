# Catatan Keuangan

Aplikasi pencatatan keuangan pribadi berbasis web (PWA) yang bisa di-install ke Android setelah login.

## Fitur
- Login email + password (Supabase Auth)
- Banyak rekening (bank, e-wallet, tunai) dengan saldo awal, plus transfer antar rekening
- Investasi: obligasi & reksa dana pasar uang (nilai diperbarui manual, dengan pengingat), kripto (harga otomatis dari CoinGecko), kekayaan bersih dan untung/rugi
- Catat pemasukan & pengeluaran per kategori
- Dashboard: saldo, ringkasan periode, arus kas, tren saldo, pengeluaran per kategori
- Bisa dibuka offline (data terakhir tetap tampil)
- Backup/impor JSON dan ekspor CSV

## Teknologi
HTML, CSS, dan JavaScript biasa (tanpa build step) + [Supabase](https://supabase.com) untuk database & login.

## Menjalankan di komputer
```bash
python -m http.server 8080
```
Lalu buka http://127.0.0.1:8080

## Setup Supabase (sekali saja)
1. Buat project di supabase.com.
2. Jalankan di **SQL Editor**, berurutan:
   1. `supabase-setup.sql`
   2. `supabase-migration-02-rekening.sql` (banyak rekening + transfer)
   3. `supabase-migration-03-investasi.sql` (obligasi, pasar uang, kripto)
3. Isi `config.js` dengan Project URL dan **publishable/anon key**.
   Key ini memang untuk frontend dan aman dipublikasikan, karena data dilindungi Row Level Security.
   **Jangan pernah** memasukkan `service_role` / `secret` key ke repo ini.
4. **Authentication → URL Configuration → Site URL** diisi alamat hosting aplikasi.

## Deploy
Upload folder ini ke hosting HTTPS mana pun (Netlify, Vercel, GitHub Pages).
Setiap kali mengubah file aplikasi, naikkan versi `CACHE` di `sw.js`.
