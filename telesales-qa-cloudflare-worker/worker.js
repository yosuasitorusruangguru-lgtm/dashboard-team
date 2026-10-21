const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", "vary": "Origin" }
  });
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.FRONTEND_ORIGIN || "*").split(",").map(v => v.trim()).filter(Boolean);
  return !origin || allowed.includes("*") || allowed.includes(origin);
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

function parseModelJson(value) {
  if (typeof value !== "string") throw new Error("Model penilaian tidak mengembalikan teks.");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Hasil QA tidak berbentuk JSON.");
  return JSON.parse(value.slice(start, end + 1));
}

const RUBRIC = `Kamu reviewer QA telesales berbahasa Indonesia. Nilai transkrip call berdasarkan matriks How To Be A Good Telesales! dan 5 gate Route of Telesales. Gunakan kategori kualitatif saja: Poor, Need Improvement, Good, Very Good, atau Perlu verifikasi. Jangan memberi skor angka/persentase. Gunakan hanya bukti yang ada di transkrip. Dilarang mengarang kutipan, waktu, harga, fitur atau klaim. Akurasi harga/produk wajib ditandai Perlu verifikasi tanpa referensi resmi. Transkrip tidak dapat menilai tone suara, smiling voice, artikulasi, volume, intonasi, empati nonverbal atau apakah agent memotong pembicaraan secara andal; untuk metrik terkait audio, beri Perlu verifikasi dan rekomendasikan review manusia. Pembayaran hanya dinilai jika relevan dengan tahap keputusan. Wording saran natural, profesional, tidak manipulatif dan tidak memaksa. Output hanya satu objek JSON valid berbahasa Indonesia dengan struktur:
{
 "grade":"Poor|Need Improvement|Good|Very Good|Perlu verifikasi",
 "method":"Transkripsi otomatis dan evaluasi isi teks memakai Cloudflare Workers AI; kualitas suara perlu review manusia.",
 "stageGrades":["kategori Opening","kategori Probing","kategori Presentation","kategori Handling Objection","kategori Closing"],
 "callMatrix":[{"name":"Call Courtesy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Call Accuracy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Call Management","ratingLabel":"kategori","description":"alasan singkat"}],
 "findings":[
 {"stage":0,"category":"Call Courtesy","title":"Standar Greeting","ratingLabel":"kategori","criteria":"standar Good/Very Good","text":"temuan berbasis transkrip","quote":"kutipan persis atau string kosong","wordingSuggestion":"saran wording"},
 {"stage":0,"category":"Call Courtesy","title":"Standar Opening","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":0,"category":"Call Courtesy","title":"Positive Telephone Attitude","ratingLabel":"Perlu verifikasi","criteria":"Nilai langsung dari audio, bukan transkrip","text":"Transkrip tidak bisa memastikan kualitas sikap/tone suara","quote":"","wordingSuggestion":"Gunakan delivery natural dan profesional; validasi dari audio."},
 {"stage":0,"category":"Call Courtesy","title":"Empathic / Responsive","ratingLabel":"kategori atau Perlu verifikasi","criteria":"Respons tepat pada jawaban user; validasi delivery dari audio","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":0,"category":"Call Courtesy","title":"Positive Tone Voice / Enthusiasm","ratingLabel":"Perlu verifikasi","criteria":"Wajib dengarkan audio asli","text":"Transkrip tidak dapat mengukur tone, smiling voice atau antusiasme secara andal.","quote":"","wordingSuggestion":"Dengarkan contoh call dan gunakan tone hangat, artikulasi jelas serta tempo nyaman."},
 {"stage":0,"category":"Call Courtesy","title":"Standar Closing Greeting","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":2,"category":"Call Accuracy","title":"Product Knowledge","ratingLabel":"Perlu verifikasi","criteria":"Cocokkan dengan sumber resmi","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":2,"category":"Call Accuracy","title":"FAB (Feature, Advantage, Benefit)","ratingLabel":"kategori atau Perlu verifikasi","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":1,"category":"Call Management","title":"Probing / Create Needs","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":3,"category":"Call Management","title":"Offer Alternative / Handling Objections","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":1,"category":"Call Management","title":"Question Responsibility","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":4,"category":"Call Management","title":"Konfirmasi rencana pembayaran","ratingLabel":"kategori atau Perlu verifikasi","criteria":"Hanya bila tahap keputusan sudah tercapai","text":"...","quote":"...","wordingSuggestion":"..."}
 ],
 "risks":[{"label":"risiko berbasis bukti atau string kosong bila tidak ada","quote":"kutipan persis atau string kosong"}],
 "tips":["prioritas coaching singkat"]
}
Nilai 5 gate berdasar transkrip secara konservatif. Jika call tidak mencapai suatu tahap, gunakan Perlu verifikasi daripada menghukum agent. `;

async function transcribe(audio, env) {
  const base64 = base64FromBuffer(await audio.arrayBuffer());
  const result = await env.AI.run("@cf/openai/whisper", {
    audio: base64,
    language: "id",
    initial_prompt: "Percakapan telesales Indonesia. Nama produk mungkin Ruangguru, Brain Academy, Ruangbelajar. Transkripsikan setia; jangan menambah kata yang tak terdengar."
  });
  const transcript = String(result?.text || "").trim();
  if (!transcript) throw new Error("Transkrip kosong. Coba recording yang suaranya lebih jelas atau durasinya lebih pendek.");
  return transcript;
}

async function analyse(transcript, agentName, env) {
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: "Nama agent: " + agentName + "\nTranskrip call:\n" + transcript.slice(0, 18000) + "\n\nBerikan penilaian lengkap sesuai struktur JSON yang diminta. Kutipan harus tepat dari transkrip." }
    ],
    temperature: 0.1,
    max_tokens: 4096
  });
  const data = parseModelJson(result?.response || result?.text || "");
  if (!Array.isArray(data.findings) || data.findings.length < 10) throw new Error("Hasil model belum mencakup seluruh matriks QA.");
  data.method = "Transkripsi otomatis dan evaluasi isi teks oleh Cloudflare Workers AI. Tone suara/antusiasme dan validitas detail produk perlu diverifikasi manusia. Penggunaan bergantung pada kuota gratis harian.";
  return data;
}

const rate = new Map();
function rateLimitOk(key) {
  const now = Date.now();
  let slot = rate.get(key);
  if (!slot || now - slot.start >= 10 * 60 * 1000) slot = { start: now, count: 0 };
  slot.count += 1;
  rate.set(key, slot);
  if (rate.size > 1500) for (const [k, v] of rate) if (now - v.start > 10 * 60 * 1000) rate.delete(k);
  return slot.count <= 4;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = originAllowed(request, env) ? (String(env.FRONTEND_ORIGIN || "*").trim() === "*" ? "*" : origin) : "null";
    if (corsOrigin === "null") return json({ error: "Origin frontend tidak diizinkan. Atur FRONTEND_ORIGIN pada Worker." }, 403, "null");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": corsOrigin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-max-age": "86400", "vary": "Origin" } });
    }
    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ ok: true, service: "telesales-qa-cloudflare-worker", aiBindingConfigured: Boolean(env.AI), accessTokenConfigured: Boolean(env.QA_ACCESS_TOKEN), mode: "free-tier-guarded" }, 200, corsOrigin);
    }
    if (url.pathname !== "/api/qa/analyze-recording" || request.method !== "POST") return json({ error: "Endpoint tidak ditemukan." }, 404, corsOrigin);
    if (!env.QA_ACCESS_TOKEN) return json({ error: "QA_ACCESS_TOKEN belum diatur sebagai Worker secret." }, 503, corsOrigin);
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.QA_ACCESS_TOKEN) return json({ error: "Token akses tidak valid. Isi token QA yang sudah diset pada Worker." }, 401, corsOrigin);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!rateLimitOk(ip)) return json({ error: "Batas analisis tercapai. Coba lagi setelah 10 menit." }, 429, corsOrigin);
    if (!env.AI) return json({ error: "AI binding belum diaktifkan pada Worker." }, 503, corsOrigin);

    try {
      const form = await request.formData();
      const audio = form.get("audio");
      const agentName = String(form.get("agentName") || "").trim();
      if (!(audio instanceof File)) return json({ error: "Field audio wajib diisi." }, 400, corsOrigin);
      if (!agentName) return json({ error: "Nama agent wajib diisi." }, 400, corsOrigin);
      if (audio.size > 10 * 1024 * 1024) return json({ error: "Mode gratis membatasi file audio maksimal 10 MB. Kompres atau potong recording sebelum upload." }, 413, corsOrigin);
      const extension = (audio.name.split(".").pop() || "").toLowerCase();
      const allowed = new Set(["mp3", "wav", "m4a", "ogg", "webm", "flac", "mp4", "mpeg", "mpga", "aac"]);
      if (!allowed.has(extension)) return json({ error: "Format tidak didukung. Pilih MP3, WAV, M4A, OGG, WEBM, FLAC, MP4, MPEG atau AAC." }, 400, corsOrigin);

      const transcript = await transcribe(audio, env);
      const analysis = await analyse(transcript, agentName, env);
      return json({ ok: true, transcript, analysis, mode: "Cloudflare Workers Free allocation; no automatic plan upgrade" }, 200, corsOrigin);
    } catch (error) {
      const message = String(error?.message || "Analisis gagal.");
      const quota = /quota|neurons|daily|limit|billing|exceeded/i.test(message);
      return json({ error: quota ? "Kuota AI gratis mungkin sudah habis atau model membatasi request. Tidak ada upgrade otomatis. Tunggu kuota reset dan coba lagi." : message }, 502, corsOrigin);
    }
  }
};
