import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const QA_ACCESS_TOKEN = process.env.QA_ACCESS_TOKEN || '';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL || 'gpt-audio';
const origins = (process.env.FRONTEND_ORIGIN || '*').split(',').map(x => x.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.includes('*') || origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin frontend tidak diizinkan oleh FRONTEND_ORIGIN.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const buckets = new Map();
function limitByIp(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = buckets.get(key) || { start: now, count: 0 };
  if (now - entry.start > 10 * 60 * 1000) { entry.start = now; entry.count = 0; }
  entry.count++;
  buckets.set(key, entry);
  if (entry.count > 4) return res.status(429).json({ error: 'Batas analisis tercapai. Coba lagi setelah 10 menit.' });
  if (buckets.size > 2000) for (const [ip, item] of buckets) if (now - item.start > 10 * 60 * 1000) buckets.delete(ip);
  next();
}
function requireAccess(req, res, next) {
  if (!QA_ACCESS_TOKEN) return res.status(503).json({ error: 'QA_ACCESS_TOKEN belum diatur pada environment backend.' });
  const auth = String(req.headers.authorization || '');
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(QA_ACCESS_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Token akses tidak valid. Isi token QA pada halaman Telesales QA.' });
  next();
}

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!new Set(['.mp3','.wav','.m4a','.ogg','.flac','.mp4','.mpeg','.mpga','.webm','.aac']).has(ext)) {
      return callback(new Error('Format audio tidak didukung. Pilih MP3, WAV, M4A, OGG, FLAC, MP4, MPEG, MPGA, WEBM, atau AAC.'));
    }
    callback(null, true);
  }
});

app.get('/healthz', (_req, res) => res.json({
  ok: true,
  service: 'telesales-qa-audio',
  apiKeyConfigured: Boolean(OPENAI_API_KEY),
  accessTokenConfigured: Boolean(QA_ACCESS_TOKEN)
}));

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.error || `OpenAI API gagal (HTTP ${response.status}).`);
  return body;
}

async function transcribe(filePath) {
  const audio = await fs.readFile(filePath);
  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'id');
  form.append('response_format', 'json');
  form.append('prompt', 'Transkripsikan secara setia percakapan telesales berbahasa Indonesia. Nama produk yang mungkin terdengar: Ruangguru, Brain Academy, Ruangbelajar. Pertahankan harga, tanggal, dan istilah produk. Jangan menambahkan kata yang tidak terdengar.');
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'recording.mp3');
  const body = await requestJson('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  const transcript = String(body.text || '').trim();
  if (!transcript) throw new Error('Transkrip kosong. Pastikan suara cukup jelas dan mengandung percakapan.');
  return transcript;
}

const rubricPrompt = `Kamu reviewer QA telesales yang menilai rekaman call nyata dengan mendengarkan audio langsung dan menggunakan transkrip sebagai alat bantu. Gunakan rubrik How To Be A Good Telesales! dengan tiga matriks:
- Call Courtesy: Standar Greeting, Standar Opening, Positive Telephone Attitude, Empathic / Responsive, Positive Tone Voice / Enthusiasm, Standar Closing Greeting.
- Call Accuracy: Product Knowledge dan FAB (Feature, Advantage, Benefit).
- Call Management: Probing / Create Needs, Offer Alternative / Handling Objections, Question Responsibility, Konfirmasi rencana pembayaran jika relevan.

Gunakan kategori kualitatif saja: Poor, Need Improvement, Good, Very Good, atau Perlu verifikasi. Jangan membuat skor angka/persentase. Nilai berdasarkan hal yang benar-benar terdengar. Kutipan harus persis dari transkrip; jangan mengarang harga, klaim, kutipan, timestamp, atau perilaku. Tone, artikulasi, antusiasme, empati yang terdengar, dan apakah agent membiarkan pelanggan berbicara perlu dinilai dari audio langsung. Harga/fasilitas tanpa referensi resmi harus Perlu verifikasi, jangan menyatakan akurat. Jika pembayaran belum relevan karena call belum masuk tahap keputusan, beri Perlu verifikasi dan jelaskan alasannya. Bedakan agent dan pelanggan sejauh mungkin; jika tidak jelas, nyatakan keterbatasan. Tandai tekanan berlebihan, promo/hasil tak terbukti, risiko privasi, serta pelanggaran integritas secara hati-hati dan berbasis bukti. Wording saran harus natural dan tidak memaksa. Return satu objek JSON valid tanpa markdown, dalam Bahasa Indonesia, sesuai struktur berikut:
{
 "grade":"Poor|Need Improvement|Good|Very Good|Perlu verifikasi",
 "method":"Analisis audio langsung dan transkrip otomatis; validasi reviewer tetap diperlukan.",
 "stageGrades":["kategori Opening","kategori Probing","kategori Presentation","kategori Handling Objection","kategori Closing"],
 "callMatrix":[{"name":"Call Courtesy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Call Accuracy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Call Management","ratingLabel":"kategori","description":"alasan singkat"}],
 "findings":[
  {"stage":0,"category":"Call Courtesy","title":"Standar Greeting","ratingLabel":"kategori","criteria":"kriteria Good/Very Good","text":"temuan berdasarkan audio","quote":"kutipan singkat atau string kosong","wordingSuggestion":"perbaikan natural"},
  {"stage":0,"category":"Call Courtesy","title":"Standar Opening","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":0,"category":"Call Courtesy","title":"Positive Telephone Attitude","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":0,"category":"Call Courtesy","title":"Empathic / Responsive","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":0,"category":"Call Courtesy","title":"Positive Tone Voice / Enthusiasm","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":0,"category":"Call Courtesy","title":"Standar Closing Greeting","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":2,"category":"Call Accuracy","title":"Product Knowledge","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":2,"category":"Call Accuracy","title":"FAB (Feature, Advantage, Benefit)","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":1,"category":"Call Management","title":"Probing / Create Needs","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":3,"category":"Call Management","title":"Offer Alternative / Handling Objections","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":1,"category":"Call Management","title":"Question Responsibility","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
  {"stage":4,"category":"Call Management","title":"Konfirmasi rencana pembayaran","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."}
 ],
 "risks":[{"label":"risiko berbasis bukti atau string kosong bila tidak ada","quote":"kutipan atau string kosong"}],
 "tips":["prioritas coaching singkat"]
}`;

async function reviewAudio(filePath, transcript, agentName) {
  const audio = await fs.readFile(filePath);
  const prompt = `Nama agent: ${agentName}\nTranskrip (bisa ada kesalahan pengenalan suara, cocokkan dengan audio):\n${transcript.slice(0, 42000)}\n\nDengarkan audio yang dilampirkan. Evaluasi semua metrik yang diminta, berikan bukti konkret, fokus juga pada tone/antusiasme, artikulasi, empati, serta apakah agent memberi waktu pelanggan menjawab. Jangan berasumsi user setuju membeli.`;
  const body = await requestJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AUDIO_MODEL,
      modalities: ['text'],
      temperature: 0.1,
      max_tokens: 5000,
      messages: [
        { role: 'system', content: rubricPrompt },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: 'mp3' } }
        ]}
      ]
    })
  });
  const contentValue = body.choices?.[0]?.message?.content;
  const content = typeof contentValue === 'string' ? contentValue :
    Array.isArray(contentValue) ? contentValue.map(x => x.text || '').join('\n') : '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model audio tidak mengembalikan JSON QA yang valid. Silakan coba lagi.');
  let parsed;
  try { parsed = JSON.parse(content.slice(start, end + 1)); }
  catch { throw new Error('Format hasil QA tidak valid. Tidak ada penilaian yang disimpan.'); }
  if (!Array.isArray(parsed.findings) || parsed.findings.length < 10) throw new Error('Hasil model belum mencakup seluruh matriks QA. Tidak ada hasil parsial yang disimpan.');
  return parsed;
}

app.post('/api/qa/analyze-recording', limitByIp, requireAccess, upload.single('audio'), async (req, res) => {
  const sourcePath = req.file?.path;
  const normalizedPath = sourcePath ? sourcePath + '-normalized.mp3' : null;
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY belum diatur pada environment backend.' });
    if (!req.file) return res.status(400).json({ error: 'Field audio wajib diisi.' });
    const agentName = String(req.body?.agentName || '').trim();
    if (!agentName) return res.status(400).json({ error: 'Nama agent wajib diisi.' });
    if (!ffmpegPath) throw new Error('FFmpeg tidak tersedia pada server.');

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-hide_banner','-loglevel','error','-y','-i',sourcePath,'-vn','-ac','1','-ar','24000','-b:a','64k',normalizedPath], { stdio: ['ignore','ignore','pipe'] });
      let stderr = '';
      proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('File audio gagal dikonversi. ' + stderr.slice(-300))));
    });
    const stat = await fs.stat(normalizedPath);
    if (stat.size > 18 * 1024 * 1024) throw new Error('Recording terlalu panjang untuk sekali analisis. Potong menjadi beberapa bagian lebih pendek.');
    const transcript = await transcribe(normalizedPath);
    const analysis = await reviewAudio(normalizedPath, transcript, agentName);
    res.json({ ok: true, transcript, analysis, requestId: crypto.randomUUID() });
  } catch (err) {
    const message = err?.message || 'Terjadi kesalahan saat menganalisis audio.';
    const status = /payload too large|file too large/i.test(message) ? 413 : 502;
    res.status(status).json({ error: message });
  } finally {
    for (const candidate of [sourcePath, normalizedPath]) if (candidate) await fs.unlink(candidate).catch(() => {});
  }
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Recording maksimal 25 MB.' });
  res.status(400).json({ error: err?.message || 'Request tidak valid.' });
});

app.listen(PORT, () => console.log(`Telesales QA audio backend listening on port ${PORT}`));
