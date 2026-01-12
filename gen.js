/**
 * GEN v2 — Image (OpenAI) + Video (fal.ai)
 *
 * Commands:
 *  - gen <prompt>     => image
 *  - fvgen <prompt>   => video (fal.ai)
 *  - genprovider      => show setup
 *
 * Requirements:
 *  - npm i axios form-data
 *
 * ENV:
 *  - OPENAI_API_KEY
 *  - FAL_KEY
 *  - (optional) GEN_OPENAI_MODEL=gpt-image-1
 *  - (optional) FAL_VIDEO_MODEL=fal-ai/ltx-video
 */

const axios = require("axios");
const { kord } = require("../core");

/* ---------- ENV ---------- */
const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = (process.env.GEN_OPENAI_MODEL || "gpt-image-1").trim();

const FAL_KEY = (process.env.FAL_KEY || "").trim();
const FAL_VIDEO_MODEL = (process.env.FAL_VIDEO_MODEL || "fal-ai/ltx-video").trim();

/* ---------- helpers ---------- */
function short(s, n = 500) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function sendImage(m, buf, caption) {
  try {
    if (typeof m.replyimg === "function") return await m.replyimg(buf, caption || "");
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { image: buf, caption: caption || "" }, { quoted: m });
    }
  } catch {}
  return m.reply ? m.reply(caption || "✅ Image ready") : null;
}

async function sendVideo(m, buf, caption) {
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { video: buf, caption: caption || "" }, { quoted: m });
    }
  } catch {}
  return m.reply ? m.reply(caption || "✅ Video ready") : null;
}

/* ---------- OpenAI IMAGE (FIXED) ---------- */
async function genImageOpenAI(prompt) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set.");

  // IMPORTANT: no response_format here
  const r = await axios.post(
    "https://api.openai.com/v1/images/generations",
    {
      model: OPENAI_MODEL,
      prompt,
      size: "1024x1024"
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 180000
    }
  );

  const b64 = r?.data?.data?.[0]?.b64_json;
  if (!b64) {
    // sometimes providers return a URL style; handle that too
    const url = r?.data?.data?.[0]?.url;
    if (url) {
      const img = await axios.get(url, { responseType: "arraybuffer", timeout: 180000 });
      return { buffer: Buffer.from(img.data), info: `OpenAI (${OPENAI_MODEL})` };
    }
    throw new Error("OpenAI: no image returned.");
  }

  return { buffer: Buffer.from(b64, "base64"), info: `OpenAI (${OPENAI_MODEL})` };
}

/* ---------- fal.ai VIDEO ---------- */
async function genVideoFal(prompt) {
  if (!FAL_KEY) throw new Error("FAL_KEY not set.");

  // fal.run REST: POST https://fal.run/<model-id>
  // Auth: Authorization: Key <FAL_KEY>
  const start = await axios.post(
    `https://fal.run/${encodeURIComponent(FAL_VIDEO_MODEL)}`,
    { prompt },
    {
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

  // typical response includes video.url (model dependent)
  const videoUrl =
    start?.data?.video?.url ||
    start?.data?.output?.video?.url ||
    start?.data?.data?.video?.url ||
    start?.data?.result?.video?.url;

  if (!videoUrl) {
    // fallback: return JSON snippet for debugging
    throw new Error("fal.ai: video URL not found in response.");
  }

  const vid = await axios.get(videoUrl, { responseType: "arraybuffer", timeout: 300000 });
  return { buffer: Buffer.from(vid.data), info: `fal.ai (${FAL_VIDEO_MODEL})` };
}

/* ---------- COMMANDS ---------- */
kord(
  { cmd: "genprovider", desc: "Show GEN provider setup", type: "tools", react: "⚙️" },
  async (m) => {
    const okOpenAI = OPENAI_KEY ? "✅" : "❌";
    const okFal = FAL_KEY ? "✅" : "❌";
    return m.reply(
      "⚙️ *GEN Setup*\n" +
        `• Image: OpenAI Images API: ${okOpenAI}\n` +
        `  - Model: ${OPENAI_MODEL}\n` +
        `• Video: fal.ai: ${okFal}\n` +
        `  - Model: ${FAL_VIDEO_MODEL}\n\n` +
        "Commands:\n" +
        "• gen <prompt>\n" +
        "• fvgen <prompt>"
    );
  }
);

kord(
  { cmd: "gen", desc: "Generate AI image (OpenAI)", type: "tools", react: "🖼️" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: gen <prompt>");
      await m.reply("✨ Generating image…");
      const { buffer, info } = await genImageOpenAI(prompt);
      return await sendImage(
        m,
        buffer,
        "🖼️ *GEN*\n" + `• Engine: ${info}\n` + `• Prompt: ${short(prompt, 300)}`
      );
    } catch (e) {
      return m.reply("❌ GEN error: " + (e?.response?.data?.error?.message || e?.message || e));
    }
  }
);

kord(
  { cmd: "fvgen", desc: "Generate AI video (fal.ai)", type: "tools", react: "🎬" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: fvgen <prompt>");
      if (!FAL_KEY) return m.reply("❌ Set FAL_KEY in your panel env first.");
      await m.reply("🎬 Generating video…");
      const { buffer, info } = await genVideoFal(prompt);
      return await sendVideo(
        m,
        buffer,
        "🎬 *FVGEN*\n" + `• Engine: ${info}\n` + `• Prompt: ${short(prompt, 250)}`
      );
    } catch (e) {
      return m.reply("❌ FVGEN error: " + (e?.response?.data?.message || e?.message || e));
    }
  }
);