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

const RUBRIC = `Kamu reviewer QA telesales berbahasa Indonesia untuk Ruangguru. Kamu menilai CHAT TEKS (WhatsApp/live chat) antara agent dan customer, berdasarkan matriks "How To Be A Good Telesales!" dan 5 gate Route of Telesales: Opening, Probing, Presentation, Handling Objection, Closing.

Aturan:
- Gunakan kategori kualitatif saja: Poor, Need Improvement, Good, Very Good, atau Perlu verifikasi. Jangan memberi skor angka/persentase.
- Gunakan hanya bukti yang ada di chat. Dilarang mengarang kutipan, waktu, harga, fitur atau klaim.
- "quote" harus kutipan persis dari pesan AGENT (atau customer bila relevan), atau string kosong.
- Detail produk/harga selalu "Perlu verifikasi" kecuali jelas salah secara internal di chat.
- Jika chat belum mencapai suatu tahap, gunakan "Perlu verifikasi" daripada menghukum agent.
- Untuk chat, nilai juga etika menulis: sapaan & nama customer, bahasa sopan dan jelas, tidak typo berlebihan, tidak spam/bubble berlebihan, emoji wajar, dan kecepatan respon bila ada timestamp.

Kembalikan HANYA JSON valid dengan struktur:
{
 "grade":"Poor|Need Improvement|Good|Very Good|Perlu verifikasi",
 "summary":"ringkasan 2-3 kalimat isi chat dan hasilnya",
 "customerNeed":"kebutuhan/kondisi customer yang tergali, atau string kosong",
 "outcome":"Closing|Follow up|Belum ada keputusan|Menolak",
 "stageGrades":["kategori Opening","kategori Probing","kategori Presentation","kategori Handling Objection","kategori Closing"],
 "chatMatrix":[{"name":"Chat Courtesy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Chat Accuracy","ratingLabel":"kategori","description":"alasan singkat"},{"name":"Chat Management","ratingLabel":"kategori","description":"alasan singkat"}],
 "findings":[
 {"stage":0,"category":"Chat Courtesy","title":"Standar Greeting & Perkenalan","ratingLabel":"kategori","criteria":"standar Good/Very Good","text":"temuan","quote":"kutipan persis atau string kosong","wordingSuggestion":"saran wording chat"},
 {"stage":0,"category":"Chat Courtesy","title":"Personalisasi (nama customer / anak)","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":0,"category":"Chat Courtesy","title":"Etika Menulis (bahasa, typo, emoji, bubble)","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":0,"category":"Chat Courtesy","title":"Empathic / Responsive","ratingLabel":"kategori","criteria":"Menanggapi isi pesan customer dengan tepat","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":0,"category":"Chat Courtesy","title":"Kecepatan Respon","ratingLabel":"kategori atau Perlu verifikasi","criteria":"Hanya bila ada timestamp","text":"...","quote":"","wordingSuggestion":"..."},
 {"stage":4,"category":"Chat Courtesy","title":"Standar Closing Greeting","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":2,"category":"Chat Accuracy","title":"Product Knowledge","ratingLabel":"Perlu verifikasi","criteria":"Cocokkan dengan sumber resmi","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":2,"category":"Chat Accuracy","title":"FAB (Feature, Advantage, Benefit)","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":1,"category":"Chat Management","title":"Probing / Create Needs","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":3,"category":"Chat Management","title":"Offer Alternative / Handling Objections","ratingLabel":"kategori","criteria":"...","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":1,"category":"Chat Management","title":"Question Responsibility","ratingLabel":"kategori","criteria":"Semua pertanyaan customer terjawab","text":"...","quote":"...","wordingSuggestion":"..."},
 {"stage":4,"category":"Chat Management","title":"Call to Action & Konfirmasi Pembayaran","ratingLabel":"kategori atau Perlu verifikasi","criteria":"Ada ajakan/next step yang jelas","text":"...","quote":"...","wordingSuggestion":"..."}
 ],
 "risks":[{"label":"risiko berbasis bukti (mis. janji berlebihan, info harga meragukan, nada kurang sopan)","quote":"kutipan persis atau string kosong"}],
 "tips":["prioritas coaching singkat, maksimal 5"]
}`;

async function analyse(chat, agentName, env) {
  const model = String(env.CHAT_MODEL || DEFAULT_MODEL);
  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: "Nama agent: " + agentName + "\nChat agent dengan customer:\n" + chat + "\n\nBerikan penilaian lengkap sesuai struktur JSON yang diminta. Kutipan harus tepat dari chat." }
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
