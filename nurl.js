const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const { kord, wtype } = require("../core");

const PUBLIC_DIR = path.join("/home/container", "public");
const VIEW_DIR = path.join(PUBLIC_DIR, "view");

if (!fs.existsSync(VIEW_DIR)) fs.mkdirSync(VIEW_DIR, { recursive: true });

function randomId(len = 10) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function makeViewerHtml(filename, type) {
  const safe = String(filename).replace(/"/g, "");
  const isVideo = String(type || "").toLowerCase().startsWith("video");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Viewer</title>
<style>
html,body{height:100%;margin:0;background:#000;display:flex;align-items:center;justify-content:center}
img,video{max-width:100%;max-height:100%}
</style>
</head>
<body>
${isVideo ? `<video src="./${safe}" controls autoplay playsinline></video>` : `<img src="./${safe}" alt="media">`}
</body>
</html>`;
}

function getQuotedMessage(m) {
  return (
    m?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m?.quoted?.message ||
    null
  );
}

async function downloadQuotedMedia(m, quoted) {
  // Best effort across kord/baileys forks
  if (typeof m?.download === "function") return await m.download();
  if (typeof m?.quoted?.download === "function") return await m.quoted.download();
  if (m?.client?.downloadMediaMessage && quoted) {
    // Some cores expose this; if not, it'll throw and be caught
    return await m.client.downloadMediaMessage({ message: quoted });
  }
  throw new Error("No download method available in this core.");
}

kord(
  {
    cmd: "nurl",
    desc: "Create a browser URL for quoted image/video",
    fromMe: wtype,
    type: "tools",
  },
  async (m) => {
    try {
      const quoted = getQuotedMessage(m);
      if (!quoted) return m.reply("Reply to an image or video.");

      const media = quoted.imageMessage || quoted.videoMessage;
      if (!media) return m.reply("Only image or video supported.");

      const mimeType = media.mimetype || "";
      const ext = mime.extension(mimeType) || (quoted.videoMessage ? "mp4" : "jpg");

      const buf = await downloadQuotedMedia(m, quoted);
      if (!buf || !Buffer.isBuffer(buf)) return m.reply("Failed to read media.");

      const id = randomId();
      const mediaName = `${id}.${ext}`;
      const htmlName = `${id}.html`;

      fs.writeFileSync(path.join(VIEW_DIR, mediaName), buf);
      fs.writeFileSync(path.join(VIEW_DIR, htmlName), makeViewerHtml(mediaName, mimeType));

      const baseUrl = (process.env.PUBLIC_URL || "").trim();
      if (!baseUrl) {
        return m.reply(
          "PUBLIC_URL is not set.\nSet it in your panel env:\nPUBLIC_URL=https://yourdomain.com"
        );
      }

      const finalUrl = `${baseUrl.replace(/\/+$/, "")}/view/${htmlName}`;
      return m.reply(finalUrl);
    } catch (e) {
      return m.reply("nurl failed: " + (e?.message || e));
    }
  }
);