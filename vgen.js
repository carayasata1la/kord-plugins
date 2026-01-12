/**
 * VGEN - Premium AI Video Generator
 *
 * Commands:
 *  vgen <prompt>   -> generate video clip from text
 *  vgeninfo        -> show replicate config & model
 *
 * Requirements:
 *  - REPLICATE_TOKEN (set in env or setvar)
 *  - (optional) GEN_VIDEO_MODEL to pick a specific model
 */

const axios = require("axios");
const { kord } = require("../core");

const TOKEN = (process.env.REPLICATE_TOKEN || "").trim();
const MODEL = (process.env.GEN_VIDEO_MODEL || "lucataco/animatediff").trim();

// Send safe video
async function sendVideo(m, buffer, caption) {
  try {
    if (typeof m.send === "function") return await m.send(buffer, { caption }, "video");
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      const jid = m.key?.remoteJid || m.chat;
      return await m.client.sendMessage(jid, { video: buffer, caption }, { quoted: m });
    }
  } catch {}
  return m.reply(caption || "Done");
}

function short(s, n = 200) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

kord(
  { cmd: "vgeninfo", desc: "Show Replicate setup", type: "tools", react: "🎬" },
  async (m) => {
    const hasToken = TOKEN ? "✅" : "❌";
    const model = MODEL || "not set";
    return m.reply(
      "🎥 *VGEN Config*\n" +
        `• Replicate Token: ${hasToken}\n` +
        `• Model: ${model}\n` +
        `\nUse: vgen <prompt>`
    );
  }
);

kord(
  { cmd: "vgen", desc: "Generate AI video from prompt", type: "tools", react: "🎬" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: vgen <prompt>");

      if (!TOKEN) return m.reply("❌ Replicate token not set (REPLICATE_TOKEN)");

      await m.reply("🎬 Generating video… this can take 1–5 minutes, wait…");

      // Start prediction
      const create = await axios.post(
        "https://api.replicate.com/v1/predictions",
        {
          model: MODEL,
          input: { prompt },
        },
        {
          headers: {
            Authorization: `Token ${TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      let pred = create.data;
      if (!pred?.urls?.get) throw new Error("Replicate: failed to start");

      // Poll until done
      const start = Date.now();
      while (true) {
        if (Date.now() - start > 7 * 60 * 1000)
          throw new Error("Replicate: timeout (~7 min)");

        const check = await axios.get(pred.urls.get, {
          headers: { Authorization: `Token ${TOKEN}` },
        });
        pred = check.data;

        if (pred.status === "succeeded") break;
        if (pred.status === "failed")
          throw new Error("Replicate failed: " + (pred.error || pred.status));

        await new Promise((r) => setTimeout(r, 5000));
      }

      // Output may be string or array
      const output = pred.output;
      const url =
        typeof output === "string"
          ? output
          : Array.isArray(output)
          ? output[0]
          : null;

      if (!url) throw new Error("No video URL from model");

      // Download result
      const videoBuf = await axios.get(url, { responseType: "arraybuffer" });
      const buffer = Buffer.from(videoBuf.data);

      const cap =
        "🎬 *VGEN*\n" +
        `• Model: ${MODEL}\n` +
        `• Prompt: ${short(prompt, 150)}`;

      return sendVideo(m, buffer, cap);
    } catch (e) {
      return m.reply("❌ VGEN error: " + (e?.message || e));
    }
  }
);