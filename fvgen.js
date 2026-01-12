const axios = require("axios");
const { kord } = require("../core");

const HF_TOKEN = (process.env.HF_TOKEN || "").trim();
const MODEL = "damo-vilab/text-to-video-ms-1.7b";

async function sendVideo(m, buf, caption) {
  if (m.client?.sendMessage) {
    return m.client.sendMessage(
      m.chat,
      { video: buf, caption },
      { quoted: m }
    );
  }
  return m.reply("✅ Video generated (fallback)");
}

kord(
  { cmd: "fvgen", desc: "FREE AI video (slow)", type: "tools", react: "🎥" },
  async (m, text) => {
    try {
      const prompt = String(text || "").trim();
      if (!prompt) return m.reply("❌ Use: fvgen <prompt>");
      if (!HF_TOKEN) return m.reply("❌ HF_TOKEN not set.");

      await m.reply("🎥 Generating FREE video… (this may take 1–3 minutes)");

      const r = await axios.post(
        `https://api-inference.huggingface.co/models/${MODEL}`,
        { inputs: prompt },
        {
          headers: { Authorization: `Bearer ${HF_TOKEN}` },
          responseType: "arraybuffer",
          timeout: 300000
        }
      );

      return sendVideo(
        m,
        Buffer.from(r.data),
        `🎥 FREE VIDEO\n• Model: ${MODEL}\n• Prompt: ${prompt.slice(0, 200)}`
      );
    } catch (e) {
      return m.reply("❌ FVGEN error: " + (e?.message || e));
    }
  }
);