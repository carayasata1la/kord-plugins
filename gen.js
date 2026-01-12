/**
 * GEN SWITCH (HF image) + FVGEN (FREE cinematic typing video)
 *
 * Commands:
 *  - gen <prompt>     -> AI IMAGE (HuggingFace)
 *  - fvgen <prompt>   -> FREE VIDEO (local cinematic typing mp4)
 *  - genprovider      -> show setup
 *
 * ENV:
 *  - GEN_IMAGE_PROVIDER=huggingface
 *  - HF_TOKEN=xxxxxxxx
 *
 * Optional ENV for FVGEN:
 *  - FVGEN_RES=720
 *  - FVGEN_FPS=12
 *  - FVGEN_SEC=4
 *  - FVGEN_BG=https://...jpg
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");
const axios = require("axios");

const { kord } = require("../core");

let Canvas = null;
try { Canvas = require("canvas"); } catch {}
let ffmpegPath = null;
try { ffmpegPath = require("ffmpeg-static"); } catch {}
let ffmpeg = null;
try { ffmpeg = require("fluent-ffmpeg"); } catch {}

const IMG_PROVIDER = String(process.env.GEN_IMAGE_PROVIDER || "").trim().toLowerCase();
const HF_TOKEN = String(process.env.HF_TOKEN || "").trim();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function short(s, n = 420) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- KORD send helpers ----------
async function sendImage(m, buf, caption) {
  try {
    if (typeof m.replyimg === "function") return await m.replyimg(buf, caption || "");
  } catch {}
  try {
    if (typeof m.send === "function") return await m.send(buf, { caption: caption || "" }, "image");
  } catch {}
  try {
    if (m.client?.sendMessage) return await m.client.sendMessage(m.chat, { image: buf, caption: caption || "" }, { quoted: m });
  } catch {}
  return m.reply ? m.reply(caption || "✅ Done") : null;
}

async function sendVideo(m, buf, caption) {
  try {
    if (typeof m.send === "function") return await m.send(buf, { caption: caption || "" }, "video");
  } catch {}
  try {
    if (m.client?.sendMessage) return await m.client.sendMessage(m.chat, { video: buf, caption: caption || "" }, { quoted: m });
  } catch {}
  return m.reply ? m.reply(caption || "✅ Done") : null;
}

// ---------- Provider check ----------
function pickImageProvider() {
  if (IMG_PROVIDER) return IMG_PROVIDER;
  if (HF_TOKEN) return "huggingface";
  return "";
}

// ---------- HF IMAGE ----------
async function genImageHuggingFace(prompt) {
  if (!HF_TOKEN) throw new Error("HF_TOKEN not set.");
  const model = "black-forest-labs/FLUX.1-schnell"; // good default
  const r = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: prompt },
    {
      headers: { Authorization: `Bearer ${HF_TOKEN}` },
      responseType: "arraybuffer",
      timeout: 180000,
      validateStatus: () => true,
    }
  );

  if (r.status >= 400) {
    const body = Buffer.isBuffer(r.data) ? r.data.toString("utf8") : JSON.stringify(r.data);
    throw new Error(`HF ${r.status}: ${short(body, 280)}`);
  }

  return { buffer: Buffer.from(r.data), info: `HF (${model})` };
}

async function generateImage(prompt) {
  const p = pickImageProvider();
  if (!p) throw new Error("No image provider configured. Set GEN_IMAGE_PROVIDER=huggingface + HF_TOKEN.");
  if (p !== "huggingface") throw new Error("Switched mode: only HuggingFace is enabled in this build.");
  return await genImageHuggingFace(prompt);
}

// ---------- Simple HTTP fetch for FVGEN background ----------
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      lib.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchBuffer(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
    } catch (e) { reject(e); }
  });
}

// ---------- FVGEN (local cinematic typing video) ----------
async function makeTypingFrame({ text, t, total, w, h, bgUrl }) {
  if (!Canvas) throw new Error("canvas not installed.");
  const { createCanvas, loadImage } = Canvas;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // bg
  try {
    const bgBuf = await fetchBuffer(bgUrl);
    const img = await loadImage(bgBuf);
    const scale = Math.max(w / img.width, h / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } catch {
    ctx.fillStyle = "#050b10";
    ctx.fillRect(0, 0, w, h);
  }

  // overlay
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);

  // panel
  const pad = Math.round(w * 0.06);
  ctx.fillStyle = "rgba(10,16,20,0.75)";
  ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);

  // border
  ctx.strokeStyle = "rgba(120,255,210,0.9)";
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  // typed chars
  const progress = Math.max(0, Math.min(1, t / total));
  const chars = Math.max(1, Math.floor(text.length * progress));
  const shown = text.slice(0, chars);

  // title
  ctx.font = `bold ${Math.round(w * 0.05)}px Sans`;
  ctx.fillStyle = "rgba(120,255,210,1)";
  ctx.fillText("FVGEN • CINEMATIC", pad + 22, pad + Math.round(w * 0.06));

  // body
  ctx.font = `${Math.round(w * 0.04)}px Sans`;
  ctx.fillStyle = "rgba(235,255,250,0.95)";

  // simple wrap
  const maxW = w - pad * 2 - 44;
  const words = shown.split(/\s+/);
  let line = "";
  let y = pad + Math.round(w * 0.13);
  const lh = Math.round(w * 0.055);

  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, pad + 22, y);
      line = word;
      y += lh;
      if (y > h - pad - 50) break;
    } else {
      line = test;
    }
  }
  if (line && y <= h - pad - 50) ctx.fillText(line, pad + 22, y);

  // cursor blink
  if (Math.floor(t * 10) % 2 === 0) {
    ctx.fillText("▍", pad + 22 + Math.min(maxW - 20, ctx.measureText(line).width + 8), y);
  }

  return canvas.toBuffer("image/png");
}

async function generateTypingVideo(prompt) {
  if (!Canvas) throw new Error("Missing package: canvas");
  if (!ffmpegPath) throw new Error("Missing package: ffmpeg-static");
  if (!ffmpeg) throw new Error("Missing package: fluent-ffmpeg");

  const res = Math.max(540, Math.min(1080, parseInt(process.env.FVGEN_RES || "720", 10) || 720));
  const fps = Math.max(8, Math.min(20, parseInt(process.env.FVGEN_FPS || "12", 10) || 12));
  const sec = Math.max(3, Math.min(10, parseInt(process.env.FVGEN_SEC || "4", 10) || 4));
  const bgUrl = String(process.env.FVGEN_BG || "https://cdn.kord.live/serve/C9Lt7Cr94t3q.jpg").trim();

  const tmp = path.join(os.tmpdir(), `fvgen_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });

  const totalFrames = fps * sec;
  try {
    for (let i = 0; i < totalFrames; i++) {
      const frame = await makeTypingFrame({
        text: prompt,
        t: i,
        total: totalFrames - 1,
        w: res,
        h: res,
        bgUrl,
      });
      fs.writeFileSync(path.join(tmp, `frame_${String(i + 1).padStart(5, "0")}.png`), frame);
    }

    ffmpeg.setFfmpegPath(ffmpegPath);
    const out = path.join(tmp, "fvgen.mp4");

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tmp, "frame_%05d.png"))
        .inputFPS(fps)
        .outputOptions([
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-c:v libx264",
          "-preset veryfast",
          "-crf 23",
        ])
        .outputFPS(fps)
        .on("end", resolve)
        .on("error", reject)
        .save(out);
    });

    return fs.readFileSync(out);
  } finally {
    // cleanup
    try {
      for (const f of fs.readdirSync(tmp)) {
        try { fs.unlinkSync(path.join(tmp, f)); } catch {}
      }
      try { fs.rmdirSync(tmp); } catch {}
    } catch {}
  }
}

// ---------- Commands ----------
kord(
  { cmd: "genprovider", desc: "Show GEN provider setup", type: "tools", react: "⚙️" },
  async (m) => {
    const chosen = pickImageProvider() || "none";
    const okHF = HF_TOKEN ? "✅" : "❌";
    const okCanvas = Canvas ? "✅" : "❌";
    const okFF = ffmpegPath && ffmpeg ? "✅" : "❌";

    return m.reply(
      "⚙️ *GEN Switch Setup*\n" +
      `• Image Provider: *${chosen}*\n` +
      `• HF_TOKEN: ${okHF}\n\n` +
      "🎬 *FVGEN (free local video)*\n" +
      `• canvas: ${okCanvas}\n` +
      `• ffmpeg-static + fluent-ffmpeg: ${okFF}\n` +
      `• FVGEN_RES=${process.env.FVGEN_RES || "720"} | FVGEN_FPS=${process.env.FVGEN_FPS || "12"} | FVGEN_SEC=${process.env.FVGEN_SEC || "4"}`
    );
  }
);

kord(
  { cmd: "gen", desc: "AI Image (HF)", type: "tools", react: "🖼️" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: gen <prompt>");
      await m.reply("✨ Generating image…");
      const { buffer, info } = await generateImage(prompt);
      return await sendImage(
        m,
        buffer,
        `🖼️ *GEN*\n• Engine: ${info}\n• Prompt: ${short(prompt, 240)}`
      );
    } catch (e) {
      return m.reply("❌ GEN error: " + (e?.message || e));
    }
  }
);

kord(
  { cmd: "fvgen", desc: "FREE cinematic typing video (no API)", type: "tools", react: "🎞️" },
  async (m, arg) => {
    try {
      const prompt = String(arg || "").trim();
      if (!prompt) return m.reply("❌ Use: fvgen <prompt>");
      await m.reply("🎞️ Rendering free cinematic video…");
      const mp4 = await generateTypingVideo(prompt);
      return await sendVideo(m, mp4, `🎞️ *FVGEN*\n• Prompt: ${short(prompt, 220)}`);
    } catch (e) {
      return m.reply("❌ FVGEN error: " + (e?.message || e));
    }
  }
);