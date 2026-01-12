/**
 * GEN - Premium AI Generator (Image + Video)
 *
 * Commands:
 *  - gen <prompt>        => generate IMAGE
 *  - vgen <prompt>       => generate VIDEO (requires REPLICATE_TOKEN)
 *  - genprovider         => show current provider setup
 *
 * ENV (pick at least one for IMAGE):
 *  - GEN_IMAGE_PROVIDER = "openai" | "stability" | "huggingface"
 *  - OPENAI_API_KEY
 *  - STABILITY_KEY
 *  - HF_TOKEN
 *
 * ENV (for VIDEO):
 *  - REPLICATE_TOKEN
 *  - GEN_VIDEO_MODEL (optional) default: "lucataco/animatediff" (or any Replicate video model)
 */

const axios = require("axios");
const FormData = require("form-data");
const { kord } = require("../core");

const IMG_PROVIDER = (process.env.GEN_IMAGE_PROVIDER || "").trim().toLowerCase();
const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();
const STABILITY_KEY = (process.env.STABILITY_KEY || "").trim();
const HF_TOKEN = (process.env.HF_TOKEN || "").trim();

const REPLICATE_TOKEN = (process.env.REPLICATE_TOKEN || "").trim();
const REPLICATE_MODEL = (process.env.GEN_VIDEO_MODEL || "lucataco/animatediff").trim();

// ---------- send helpers (works across KORD variants) ----------
async function sendImage(m, buf, caption) {
  try {
    if (typeof m.replyimg === "function") return await m.replyimg(buf, caption || "");
  } catch {}
  try {
    if (m.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { image: buf, caption: caption || "" }, { quoted: m });
    }
  } catch {}
  return m.reply("✅ Generated image (but your KORD sendImage method is unknown).");
}

async function sendVideo(m, buf, caption) {
  try {
    if (m.client?.sendMessage) {
      return await m.client.sendMessage(
        m.chat,
        { video: buf, caption: caption || "", gifPlayback: false },
        { quoted: m }
      );
    }
  } catch {}
  return m.reply("✅ Generated video (but your KORD sendVideo method is unknown).");
}

function pickImageProvider() {
  // auto-pick based on keys if GEN_IMAGE_PROVIDER not set
  if (IMG_PROVIDER) return IMG_PROVIDER;
  if (OPENAI_KEY) return "openai";
  if (STABILITY_KEY) return "stability";
  if (HF_TOKEN) return "huggingface";
  return "";
}

function short(s, n = 700) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- IMAGE PROVIDERS ----------
async function genImageOpenAI(prompt) {
  // Uses OpenAI Images API (requires OPENAI_API_KEY)
  // Returns { buffer, info }
  const r = await axios.post(
    "https://api.openai.com/v1/images/generations",
    { model: "gpt-image-1", prompt, size: "1024x1024" },
    { headers: { Authorization: `Bearer ${OPENAI_KEY}` }, timeout: 180000 }
  );

  // OpenAI returns base64 in some cases: data[0].b64_json
  const b64 = r?.data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI: No image returned");
  return { buffer: Buffer.from(b64, "base64"), info: "OpenAI (gpt-image-1)" };
}

async function genImageStability(prompt) {
  // Stability AI (requires STABILITY_KEY)
  // Uses SDXL endpoint
  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("output_format", "png");
  fd.append("model", "sd3.5-large"); // if unavailable on your plan, change to "sdxl-1.0"

  const r = await axios.post("https://api.stability.ai/v2beta/stable-image/generate/core", fd, {
    headers: {
      Authorization: `Bearer ${STABILITY_KEY}`,
      ...fd.getHeaders(),
    },
    responseType: "arraybuffer",
    timeout: 180000,
  });

  return { buffer: Buffer.from(r.data), info: "Stability" };
}

async function genImageHuggingFace(prompt) {
  // HuggingFace Inference (requires HF_TOKEN)
  // Model can be replaced anytime
  const model = "black-forest-labs/FLUX.1-schnell";
  const r = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: prompt },
    {
      headers: { Authorization: `Bearer ${HF_TOKEN}` },
      responseType: "arraybuffer",
      timeout: 180000,
    }
  );
  return { buffer: Buffer.from(r.data), info: `HF (${model})` };
}

async function generateImage(prompt) {
  const p = pickImageProvider();
  if (!p) throw new Error("No image provider configured. Set OPENAI_API_KEY or STABILITY_KEY or HF_TOKEN.");
  if (p === "openai") {
    if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing.");
    return await genImageOpenAI(prompt);
  }
  if (p === "stability") {
    if (!STABILITY_KEY) throw new Error("STABILITY_KEY missing.");
    return await genImageStability(prompt);
  }
  if (p === "huggingface") {
    if (!HF_TOKEN) throw new Error("HF_TOKEN missing.");
    return await genImageHuggingFace(prompt);
  }
  throw new Error("Unknown GEN_IMAGE_PROVIDER: " + p);
}

// ---------- VIDEO (Replicate) ----------
async function genVideoReplicate(prompt) {
  if (!REPLICATE_TOKEN) throw new Error("REPLICATE_TOKEN missing.");

  // Create prediction
  const create = await axios.post(
    "https://api.replicate.com/v1/predictions",
    {
      version: null, // optional; we’ll use "model" form instead
      input: { prompt },
      model: REPLICATE_MODEL,
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

  // Poll until done
  const started = Date.now();
  while (true) {
    if (Date.now() - started > 6 * 60 * 1000) throw new Error("Replicate: timeout (6 mins)");

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

  // output might be string URL or array
  const out = pred.output;
  const url = Array.isArray(out) ? out[0] : out;
  if (!url || typeof url !== "string") throw new Error("Replicate: no video URL output.");

  // download video buffer
  const vid = await axios.get(url, { responseType: "arraybuffer", timeout: 180000 });
  return { buffer: Buffer.from(vid.data), info: `Replicate (${REPLICATE_MODEL})` };
}

// ---------- COMMANDS ----------
kord(
  { cmd: "genprovider", desc: "Show GEN provider setup", type: "tools", react: "⚙️" },
  async (m) => {
    const chosen = pickImageProvider() || "none";
    const okOpenAI = OPENAI_KEY ? "✅" : "❌";
    const okStab = STABILITY_KEY ? "✅" : "❌";
    const okHF = HF_TOKEN ? "✅" : "❌";
    const okRep = REPLICATE_TOKEN ? "✅" : "❌";

    return m.reply(
      "⚙️ *GEN Setup*\n" +
        `• Image Provider: *${chosen}*\n` +
        `• OPENAI_API_KEY: ${okOpenAI}\n` +
        `• STABILITY_KEY: ${okStab}\n` +
        `• HF_TOKEN: ${okHF}\n` +
        "\n🎥 *Video (Replicate)*\n" +
        `• REPLICATE_TOKEN: ${okRep}\n` +
        `• GEN_VIDEO_MODEL: ${REPLICATE_MODEL}`
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
      const { buffer, info } = await generateImage(prompt);

      const cap =
        "🖼️ *GEN*\n" +
        `• Engine: ${info}\n` +
        `• Prompt: ${short(prompt, 300)}`;

      return await sendImage(m, buffer, cap);
    } catch (e) {
      return m.reply("❌ GEN error: " + (e?.message || e));
    }
  }
);

kord(
  { cmd: "vgen", desc: "Generate premium AI video clip", type: "tools", react: "🎬" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: vgen <prompt>");
      if (!REPLICATE_TOKEN) return m.reply("❌ Video not configured. Set REPLICATE_TOKEN in config.env");

      await m.reply("🎬 Generating video… (this can take ~1-5 mins)");
      const { buffer, info } = await genVideoReplicate(prompt);

      const cap =
        "🎬 *VGEN*\n" +
        `• Engine: ${info}\n` +
        `• Prompt: ${short(prompt, 250)}`;

      return await sendVideo(m, buffer, cap);
    } catch (e) {
      return m.reply("❌ VGEN error: " + (e?.message || e));
    }
  }
);