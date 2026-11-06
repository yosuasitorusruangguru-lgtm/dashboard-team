// Bedah Chat — Telesales QA untuk chat teks (WhatsApp / live chat).
// Berjalan di Cloudflare Workers Free dengan binding Workers AI bernama `AI`.
// Tidak menyimpan chat: teks hanya diproses lalu hasilnya dikembalikan ke halaman.

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_CHAT_CHARS = 30000;

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin"
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...corsHeaders(origin) } });
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.FRONTEND_ORIGIN || "*").split(",").map((v) => v.trim()).filter(Boolean);
  return !origin || allowed.includes("*") || allowed.includes(origin);
}

function parseModelJson(value) {
  if (typeof value === "object" && value) return value;
  if (typeof value !== "string") throw new Error("Model penilaian tidak mengembalikan teks.");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Hasil QA tidak berbentuk JSON. Coba analisis ulang.");
  return JSON.parse(value.slice(start, end + 1));
}

const RUBRIC = `Kamu reviewer QA telesales Ruangguru. Nilai CHAT (WhatsApp/live chat) antara agent dan customer berdasarkan matriks "How To Be A Good Telesales!" dan 5 tahap Route of Telesales: Opening (0), Probing (1), Presentation (2), Handling Objection (3), Closing (4).

Aturan:
- Pakai kategori kualitatif saja: "Very Good", "Good", "Need Improvement", "Poor", atau "Perlu verifikasi". Jangan pakai skor angka/persen.
- Gunakan hanya bukti yang ada di chat. Jangan mengarang kutipan, harga, fitur, atau janji.
- "quote" harus kutipan persis dari chat (utamakan pesan agent), atau string kosong.
- Kebenaran detail produk/harga selalu "Perlu verifikasi" kecuali jelas salah dari chat itu sendiri.
- Jika chat belum sampai ke suatu tahap, nilai tahap itu "Perlu verifikasi", bukan "Poor".
- Untuk chat, nilai juga etika menulis: sapaan dan nama customer, bahasa sopan dan jelas, typo, bubble beruntun, emoji wajar, kecepatan respon jika ada jam.
- "wordingSuggestion" berisi contoh kalimat chat yang bisa langsung dipakai agent, dengan gaya sopan khas Ruangguru (panggil "Bunda/Ayah/Kak" sesuai chat).
- Tulis semua teks dalam Bahasa Indonesia.

Balas HANYA dengan satu objek JSON berbentuk:
{"grade": string, "summary": "2-3 kalimat", "customerNeed": string, "outcome": "Closing|Follow up|Belum ada keputusan|Menolak",
 "stageGrades": [5 string sesuai urutan tahap],
 "chatMatrix": [{"name":"Chat Courtesy","ratingLabel":string,"description":string},{"name":"Chat Accuracy",...},{"name":"Chat Management",...}],
 "findings": [{"stage": angka 0-4, "category": "Chat Courtesy|Chat Accuracy|Chat Management", "title": string, "ratingLabel": string, "text": string, "quote": string, "wordingSuggestion": string}],
 "risks": [{"label": string, "quote": string}],
 "tips": [maksimal 5 string]}

"findings" wajib berisi 12 poin ini dengan judul persis: "Standar Greeting & Perkenalan" (0), "Personalisasi (nama customer/anak)" (0), "Etika Menulis (bahasa, typo, emoji, bubble)" (0), "Empathic / Responsive" (0), "Kecepatan Respon" (0), "Probing / Create Needs" (1), "Question Responsibility" (1), "Product Knowledge" (2), "FAB (Feature, Advantage, Benefit)" (2), "Offer Alternative / Handling Objections" (3), "Call to Action & Konfirmasi Pembayaran" (4), "Standar Closing Greeting" (4). "risks" boleh array kosong.`;

async function analyse(chat, agentName, env) {
  const model = String(env.CHAT_MODEL || DEFAULT_MODEL);
  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: "Nama agent: " + agentName + "\nChat:\n\"\"\"\n" + chat + "\n\"\"\"\n\nBalas hanya dengan objek JSON sesuai struktur." }
    ],
    temperature: 0.1,
    max_tokens: 4096
  });
  const data = parseModelJson(result?.response ?? result?.text ?? "");
  if (!Array.isArray(data.findings) || data.findings.length < 8) throw new Error("Hasil model belum mencakup seluruh matriks QA. Coba analisis ulang.");
  data.method = "Evaluasi isi chat oleh Cloudflare Workers AI (" + model + "). Detail produk/harga dan temuan berisiko tinggi perlu diverifikasi manusia.";
  return data;
}

// Batas sederhana per IP: 6 analisis per 10 menit (menjaga kuota gratis harian).
const rate = new Map();
function rateLimitOk(key) {
  const now = Date.now();
  let slot = rate.get(key);
  if (!slot || now - slot.start >= 10 * 60 * 1000) slot = { start: now, count: 0 };
  slot.count += 1;
  rate.set(key, slot);
  if (rate.size > 1500) for (const [k, v] of rate) if (now - v.start > 10 * 60 * 1000) rate.delete(k);
  return slot.count <= 6;
}

async function readInput(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json();
    return { chat: String(body.chat || ""), agentName: String(body.agentName || "") };
  }
  const form = await request.formData();
  let chat = String(form.get("chat") || "");
  const file = form.get("file");
  if (!chat && file instanceof File) chat = await file.text();
  return { chat, agentName: String(form.get("agentName") || "") };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = originAllowed(request, env) ? (String(env.FRONTEND_ORIGIN || "*").trim() === "*" ? "*" : origin) : "null";
    if (corsOrigin === "null") return json({ error: "Origin frontend tidak diizinkan. Atur FRONTEND_ORIGIN pada Worker." }, 403, "null");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders(corsOrigin), "access-control-max-age": "86400" } });
    }
    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ ok: true, service: "bedah-chat-worker", aiBindingConfigured: Boolean(env.AI), accessTokenConfigured: Boolean(env.QA_ACCESS_TOKEN), model: String(env.CHAT_MODEL || DEFAULT_MODEL) }, 200, corsOrigin);
    }
    if (url.pathname !== "/api/qa/analyze-chat" || request.method !== "POST") return json({ error: "Endpoint tidak ditemukan. Gunakan POST /api/qa/analyze-chat." }, 404, corsOrigin);
    if (!env.QA_ACCESS_TOKEN) return json({ error: "QA_ACCESS_TOKEN belum diatur sebagai Worker secret." }, 503, corsOrigin);
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.QA_ACCESS_TOKEN) return json({ error: "Token akses tidak valid." }, 401, corsOrigin);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!rateLimitOk(ip)) return json({ error: "Batas analisis tercapai. Coba lagi setelah 10 menit." }, 429, corsOrigin);
    if (!env.AI) return json({ error: "AI binding belum diaktifkan pada Worker." }, 503, corsOrigin);

    try {
      const { chat, agentName } = await readInput(request);
      const cleanChat = chat.replace(/\r\n/g, "\n").trim();
      const cleanAgent = agentName.trim();
      if (!cleanAgent) return json({ error: "Nama agent wajib diisi." }, 400, corsOrigin);
      if (cleanChat.length < 40) return json({ error: "Chat terlalu pendek untuk dianalisis." }, 400, corsOrigin);
      if (cleanChat.length > MAX_CHAT_CHARS) return json({ error: "Chat terlalu panjang (maks " + MAX_CHAT_CHARS.toLocaleString("id-ID") + " karakter). Potong ke satu percakapan saja." }, 413, corsOrigin);
      const analysis = await analyse(cleanChat, cleanAgent, env);
      return json({ ok: true, analysis }, 200, corsOrigin);
    } catch (error) {
      const message = String(error?.message || "Analisis gagal.");
      const quota = /quota|neurons|daily|billing|exceeded/i.test(message);
      return json({ error: quota ? "Kuota AI gratis harian mungkin sudah habis. Tidak ada upgrade otomatis. Coba lagi setelah kuota reset." : message }, 502, corsOrigin);
    }
  }
};
