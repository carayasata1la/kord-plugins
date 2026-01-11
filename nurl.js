const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { kord } = require("../core");

const BASE = process.env.NURL_PUBLIC_URL;

async function downloadToFile(m) {
  const dl = await m.download();

  // 1) If download() returned a path string
  if (typeof dl === "string" && fs.existsSync(dl)) {
    return { filePath: dl, cleanup: false };
  }

  // 2) If download() returned a Buffer
  if (Buffer.isBuffer(dl)) {
    const tmp = path.join(os.tmpdir(), `nurl_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(tmp, dl);
    return { filePath: tmp, cleanup: true };
  }

  // 3) If download() returned { buffer: Buffer }
  if (dl && Buffer.isBuffer(dl.buffer)) {
    const tmp = path.join(os.tmpdir(), `nurl_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(tmp, dl.buffer);
    return { filePath: tmp, cleanup: true };
  }

  throw new Error("download() returned unsupported type");
}

kord(
  { cmd: "nurl", desc: "Create web URL for image/video", type: "tools" },
  async (m) => {
    try {
      if (!BASE) return m.reply("❌ NURL_PUBLIC_URL not set");

      const q = m.quoted || m;
      const hasMedia =
        q?.message?.imageMessage ||
        q?.message?.videoMessage ||
        q?.message?.documentMessage ||
        q?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
        q?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;

      if (!hasMedia) return m.reply("❌ Reply to an image or video");

      const { filePath, cleanup } = await downloadToFile(q);

      const form = new FormData();
      form.append("file", fs.createReadStream(filePath));

      const res = await axios.post(`${BASE}/upload`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
      });

      if (cleanup) {
        try { fs.unlinkSync(filePath); } catch {}
      }

      const url = res?.data?.url;
      if (!url) return m.reply("❌ Upload failed: server returned no url");

      return m.reply(`✅ ${url}`);
    } catch (e) {
      const code = e?.response?.status;
      const data = e?.response?.data;
      const msg = data?.error || data?.message || e?.message || String(e);
      return m.reply(`❌ NURL error: ${code ? code + " " : ""}${msg}`);
    }
  }
);