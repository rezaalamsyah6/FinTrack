# Catatan Keuangan

Aplikasi pencatatan keuangan pribadi berbasis web (PWA) yang bisa di-install ke Android setelah login.

## Fitur
- Login email + password (Supabase Auth)
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
2. Jalankan isi `supabase-setup.sql` di **SQL Editor**.
3. Isi `config.js` dengan Project URL dan **publishable/anon key**.
   Key ini memang untuk frontend dan aman dipublikasikan, karena data dilindungi Row Level Security.
   **Jangan pernah** memasukkan `service_role` / `secret` key ke repo ini.
4. **Authentication → URL Configuration → Site URL** diisi alamat hosting aplikasi.

## Deploy
Upload folder ini ke hosting HTTPS mana pun (Netlify, Vercel, GitHub Pages).
Setiap kali mengubah file aplikasi, naikkan versi `CACHE` di `sw.js`.
