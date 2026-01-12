const axios = require("axios");
const FormData = require("form-data");
const { kord } = require("../core");

const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();
const STABILITY_KEY = (process.env.STABILITY_KEY || "").trim();
const HF_TOKEN = (process.env.HF_TOKEN || "").trim();

function pickProvider() {
  if (OPENAI_KEY) return "openai";
  if (STABILITY_KEY) return "stability";
  if (HF_TOKEN) return "hf";
  return "";
}

async function sendImage(m, buf, caption) {
  if (m.client?.sendMessage) {
    return m.client.sendMessage(
      m.chat,
      { image: buf, caption },
      { quoted: m }
    );
  }
  return m.reply("✅ Image generated (send method fallback)");
}

/* ---------- OPENAI ---------- */
async function genOpenAI(prompt) {
  const r = await axios.post(
    "https://api.openai.com/v1/images/generations",
    {
      model: "gpt-image-1",
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
  if (!b64) throw new Error("OpenAI returned no image");
  return Buffer.from(b64, "base64");
}

/* ---------- STABILITY ---------- */
async function genStability(prompt) {
  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("output_format", "png");

  const r = await axios.post(
    "https://api.stability.ai/v2beta/stable-image/generate/core",
    fd,
    {
      headers: {
        Authorization: `Bearer ${STABILITY_KEY}`,
        ...fd.getHeaders()
      },
      responseType: "arraybuffer",
      timeout: 180000
    }
  );

  return Buffer.from(r.data);
}

/* ---------- HUGGINGFACE ---------- */
async function genHF(prompt) {
  const model = "black-forest-labs/FLUX.1-schnell";
  const r = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: prompt },
    {
      headers: { Authorization: `Bearer ${HF_TOKEN}` },
      responseType: "arraybuffer",
      timeout: 180000
    }
  );
  return Buffer.from(r.data);
}

/* ---------- COMMAND ---------- */
kord(
  { cmd: "gen", desc: "Generate AI image", type: "tools", react: "🖼️" },
  async (m, text) => {
    try {
      const prompt = String(text || "").trim();
      if (!prompt) return m.reply("❌ Use: gen <prompt>");

      const provider = pickProvider();
      if (!provider) {
        return m.reply("❌ No image provider configured.");
      }

      await m.reply("✨ Generating image…");

      let img;
      if (provider === "openai") img = await genOpenAI(prompt);
      else if (provider === "stability") img = await genStability(prompt);
      else img = await genHF(prompt);

      return sendImage(
        m,
        img,
        `🖼️ GEN\n• Provider: ${provider}\n• Prompt: ${prompt.slice(0, 300)}`
      );
    } catch (e) {
      return m.reply("❌ GEN error: " + (e?.message || e));
    }
  }
);