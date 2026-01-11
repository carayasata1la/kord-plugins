const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const { kord } = require("../core");

const BASE = process.env.NURL_PUBLIC_URL;

kord({
  cmd: "nurl",
  desc: "Create web URL for image/video",
  type: "tools"
}, async (m) => {
  try {
    if (!BASE) return m.reply("❌ NURL_PUBLIC_URL not set");

    const msg =
      m.quoted ||
      m.message?.imageMessage ||
      m.message?.videoMessage;

    if (!msg) {
      return m.reply("❌ Reply to an image or video");
    }

    const media = await m.download();
    if (!media) return m.reply("❌ Failed to get media");

    const form = new FormData();
    form.append("file", fs.createReadStream(media));

    const res = await axios.post(`${BASE}/upload`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity
    });

    if (!res.data?.url) {
      return m.reply("❌ Upload failed");
    }

    return m.reply(`🌐 ${res.data.url}`);
  } catch (e) {
    return m.reply("❌ NURL error");
  }
});