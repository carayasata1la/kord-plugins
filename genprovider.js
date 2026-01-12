/**
 * GEN - Premium AI Generator (Image + Video) [FIXED]
 *
 * Commands:
 *  - gen <prompt>        => generate IMAGE (OpenAI)
 *  - vgen <prompt>       => generate VIDEO (Replicate)
 *  - genprovider         => show current setup
 *
 * ENV (Image - OpenAI):
 *  - OPENAI_API_KEY
 *
 * ENV (Video - Replicate):
 *  - REPLICATE_TOKEN
 *  - GEN_VIDEO_VERSION (optional) default: animate-diff version id below
 */

const axios = require("axios");
const { kord } = require("../core");

const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();

const REPLICATE_TOKEN = (process.env.REPLICATE_TOKEN || "").trim();
// Default: lucataco/animate-diff version beecf59c...
// (This is a version id, NOT a model name)
const REPLICATE_VERSION = (process.env.GEN_VIDEO_VERSION ||
  "beecf59c4aee8d81bf04f0381033dfa10dc16e845b4ae00d281e2fa377e48a9f"
).trim();

function short(s, n = 500) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- send helpers (KORD variants) ----------
async function sendImage(m, buf, caption) {
  try {
    if (typeof m.replyimg === "function") return await m.replyimg(buf, caption || "");
  } catch {}
  try {
    if (m.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { image: buf, caption: caption || "" }, { quoted: m });
    }
  } catch {}
  return m.reply("✅ Image generated (but I couldn't detect your image sender method).");
}

async function sendVideo(m, buf, caption) {
  try {
    if (m.client?.sendMessage) {
      return await m.client.sendMessage(
        m.chat,
        { video: buf, caption: caption || "" },
        { quoted: m }
      );
    }
  } catch {}
  return m.reply("✅ Video generated (but I couldn't detect your video sender method).");
}

// ---------- OpenAI Image (robust: retries size/no-size) ----------
async function genImageOpenAI(prompt) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set.");

  const url = "https://api.openai.com/v1/images/generations";

  const headers = {
    Authorization: `Bearer ${OPENAI_KEY}`,
    "Content-Type": "application/json",
  };

  // Try with size first, then retry without size if OpenAI rejects it.
  const payloads = [
    { model: "gpt-image-1", prompt, size: "1024x1024", response_format: "b64_json" },
    { model: "gpt-image-1", prompt, response_format: "b64_json" },
  ];

  let lastErr;
  for (const body of payloads) {
    try {
      const r = await axios.post(url, body, { headers, timeout: 180000 });
      const b64 = r?.data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI: No b64_json returned.");
      return { buffer: Buffer.from(b64, "base64"), info: "OpenAI (gpt-image-1)" };
    } catch (e) {
      lastErr = e;
      // only retry on 400-ish
      const code = e?.response?.status;
      if (code && code !== 400) throw e;
    }
  }
  throw lastErr || new Error("OpenAI image failed.");
}

// ---------- Replicate Video (FIXED: uses version id) ----------
async function genVideoReplicate(prompt) {
  if (!REPLICATE_TOKEN) throw new Error("REPLICATE_TOKEN not set.");

  // 1) create prediction
  const create = await axios.post(
    "https://api.replicate.com/v1/predictions",
    {
      version: REPLICATE_VERSION,
      input: {
        prompt,
        // optional safe defaults (animate-diff supports these):
        steps: 25,
        guidance_scale: 7.5,
        seed: 0,
      },
    },
    {
      headers: {
        Authorization: `Token ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  let pred = create.data;
  if (!pred?.urls?.get) throw new Error("Replicate: prediction start failed.");

  // 2) poll
  const started = Date.now();
  while (true) {
    if (Date.now() - started > 8 * 60 * 1000) throw new Error("Replicate: timeout (8 mins)");

    const check = await axios.get(pred.urls.get, {
      headers: { Authorization: `Token ${REPLICATE_TOKEN}` },
      timeout: 60000,
    });

    pred = check.data;

    if (pred.status === "succeeded") break;
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error("Replicate: " + (pred.error || pred.status));
    }

    await new Promise((r) => setTimeout(r, 3500));
  }

  // animate-diff output schema is a single URL string
  const outUrl = pred.output;
  if (!outUrl || typeof outUrl !== "string") throw new Error("Replicate: no output URL.");

  // 3) download video
  const vid = await axios.get(outUrl, { responseType: "arraybuffer", timeout: 180000 });
  return { buffer: Buffer.from(vid.data), info: `Replicate (animate-diff)` };
}

// ---------- Commands ----------
kord(
  { cmd: "genprovider", desc: "Show GEN provider setup", type: "tools", react: "⚙️" },
  async (m) => {
    const okOpenAI = OPENAI_KEY ? "✅" : "❌";
    const okRep = REPLICATE_TOKEN ? "✅" : "❌";

    return m.reply(
      "⚙️ *GEN Setup*\n" +
        `• OPENAI_API_KEY: ${okOpenAI}\n` +
        "\n🎥 *VGEN (Replicate)*\n" +
        `• REPLICATE_TOKEN: ${okRep}\n` +
        `• GEN_VIDEO_VERSION: ${REPLICATE_VERSION}`
    );
  }
);

kord(
  { cmd: "gen", desc: "Generate premium AI image", type: "tools", react: "🖼️" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: gen <prompt>");
      await m.reply("✨ Generating image…");

      const { buffer, info } = await genImageOpenAI(prompt);
      return await sendImage(
        m,
        buffer,
        `🖼️ *GEN*\n• Engine: ${info}\n• Prompt: ${short(prompt, 300)}`
      );
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e?.message || String(e);
      return m.reply("❌ GEN error: " + msg);
    }
  }
);

kord(
  { cmd: "vgen", desc: "Generate premium AI video clip", type: "tools", react: "🎬" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: vgen <prompt>");
      if (!REPLICATE_TOKEN) return m.reply("❌ REPLICATE_TOKEN not set in config.env");

      await m.reply("🎬 Generating video… (can take 1–8 mins)");
      const { buffer, info } = await genVideoReplicate(prompt);

      return await sendVideo(
        m,
        buffer,
        `🎬 *VGEN*\n• Engine: ${info}\n• Prompt: ${short(prompt, 250)}`
      );
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e);
      return m.reply("❌ VGEN error: " + msg);
    }
  }
);