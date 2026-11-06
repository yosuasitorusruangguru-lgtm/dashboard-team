# Bedah Chat — Cloudflare Worker

API untuk menilai **chat teks** agent telesales (WhatsApp / live chat) memakai matriks
*How To Be A Good Telesales!* dan 5 gate Route of Telesales
(Opening, Probing, Presentation, Handling Objection, Closing).

Halaman untuk agent: https://yosuasitorusruangguru-lgtm.github.io/dashboard-team/bedah-chat/ (file `bedah-chat/index.html`). Alamat worker diatur di konstanta `WORKER_URL` di file itu; Agent tidak perlu kode akses: worker otomatis menerima permintaan dari halaman itu (lihat `AGENT_PAGE_ORIGINS` di `worker.js`). `QA_ACCESS_TOKEN` opsional, hanya untuk akses dari tempat lain.

- Berjalan di **Cloudflare Workers Free** dengan Workers AI (default model `@cf/meta/llama-3.1-8b-instruct-fp8`).
- Tidak butuh OpenAI API key dan tidak menyimpan chat.
- Kuota AI gratis harian terbatas; bila habis, API mengembalikan error dan bisa dicoba lagi setelah reset. Jangan upgrade plan untuk prototipe ini.

## Deploy lewat dashboard Cloudflare (tanpa CLI)

1. Login Cloudflare → **Workers & Pages** → buat / buka Worker (mis. `bedah-chat-api`).
2. Klik **Edit code**, ganti seluruh isi dengan `worker.js` dari folder ini, lalu **Deploy**.
3. **Settings → Bindings**: tambahkan Workers AI binding dengan nama `AI`.
4. **Settings → Variables and Secrets**:
   - Secret `QA_ACCESS_TOKEN`: string acak panjang (jangan di-commit ke GitHub).
   - Variable `FRONTEND_ORIGIN`: `https://yosuasitorusruangguru-lgtm.github.io` (atau `*` untuk uji coba).
   - (Opsional) Variable `CHAT_MODEL`: model Workers AI lain bila ingin hasil lebih tajam, mis. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (memakai kuota lebih banyak).
5. Buka `https://NAMA-WORKER.workers.dev/healthz` → harus muncul `"ok": true`.
6. Di halaman Bedah Chat, isi endpoint `https://NAMA-WORKER.workers.dev/api/qa/analyze-chat` dan token yang sama.

## Endpoint

- `GET /healthz` — status konfigurasi (tanpa menampilkan secret).
- `POST /api/qa/analyze-chat` — header `Authorization: Bearer <QA_ACCESS_TOKEN>`.
  Body JSON `{ "agentName": "...", "chat": "..." }` atau form-data `agentName` + `chat`/`file` (.txt export WhatsApp).
  Maks 30.000 karakter per chat; 6 analisis per IP per 10 menit.

## Catatan

- Halaman menyamarkan nomor telepon dan email sebelum chat dikirim.
- Hasil AI adalah bahan coaching. Detail produk/harga dan temuan berisiko tinggi wajib divalidasi manusia sebelum dipakai untuk penilaian kinerja.
- Upload chat hanya bila sesuai aturan izin dan retensi data customer.
