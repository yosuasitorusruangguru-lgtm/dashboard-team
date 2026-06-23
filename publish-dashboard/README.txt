Cara share dashboard ke team

File utama:
index.html

Opsi paling mudah: Netlify Drop
1. Buka https://app.netlify.com/drop
2. Drag folder publish-dashboard ke halaman itu.
3. Tunggu upload selesai.
4. Copy link https://... dari Netlify.
5. Kirim link itu ke team.

Opsi Cloudflare Pages
1. Buka Cloudflare Pages.
2. Upload folder publish-dashboard sebagai static site.
3. Jadikan index.html sebagai halaman utama.
4. Share URL hasil deploy ke team.

Catatan akses data
- Dashboard membaca Google Sheet langsung dari browser.
- Team tetap harus punya akses view ke Google Sheet sumber.
- Kalau Google Sheet dibuat private, dashboard tidak akan bisa memuat data untuk user yang tidak punya akses.

Jangan kirim path lokal seperti:
C:/Users/Ruangguru/Documents/sample chat/...

Path lokal hanya bisa dibuka dari laptop kamu sendiri.
