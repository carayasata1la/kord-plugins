/**
 * Premium LinkCard (clickable)
 * cmd: linkcard | lcard | card | link
 * Usage:
 *   .linkcard https://example.com
 *   .lcard example.com
 *
 * Optional setvar:
 *   LINKCARD_THUMB = direct image url (overrides thum.io)
 *   LINKCARD_TITLE = custom title override
 */

const https = require("https");
const http = require("http");
const { kord, wtype, prefix, config } = require("../core");

function getCfgAny() {
  try { return typeof config === "function" ? (config() || {}) : (config || {}); } catch { return {}; }
}

function getVar(name, fallback = "") {
  const env = process.env?.[name];
  if (env !== undefined && env !== null && String(env).trim()) return String(env).trim();
  const cfg = getCfgAny();
  const v = cfg?.[name];
  if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  return fallback;
}

function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return ".";
}

function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

function fetchText(url, ms = 7000) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      const req = lib.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchText(res.headers.location, ms));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      });
      req.on("error", () => resolve(""));
      req.setTimeout(ms, () => {
        try { req.destroy(); } catch {}
        resolve("");
      });
    } catch {
      resolve("");
    }
  });
}

function extractTitle(html) {
  if (!html) return "";
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return String(m[1]).replace(/\s+/g, " ").trim().slice(0, 60);
}

async function sendLinkCard(m, url, title, thumbUrl) {
  // thumb buffer (optional)
  let thumbBuf = null;
  try {
    thumbBuf = await new Promise((resolve) => {
      const lib = thumbUrl.startsWith("https") ? https : http;
      lib.get(thumbUrl, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", () => resolve(null));
    });
  } catch {
    thumbBuf = null;
  }

  // 1) Try framework m.send
  try {
    if (typeof m.send === "function") {
      // Some cores support "externalAdReply" via options
      return await m.send(
        `🔗 ${title}\n${url}`,
        {
          contextInfo: {
            externalAdReply: {
              title: title,
              body: "Tap to open website",
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false,
              sourceUrl: url,
              thumbnail: thumbBuf || undefined,
            },
          },
          buttons: [
            { buttonId: "open_site", buttonText: { displayText: "OPEN WEBSITE" }, type: 1 },
          ],
          footer: "KORD LinkCard",
        },
        "text"
      );
    }
  } catch {}

  // 2) Fallback to Baileys-style direct sendMessage if present
  try {
    if (m?.client?.sendMessage) {
      const jid = m?.key?.remoteJid || m?.chat;
      const msg = {
        text: `🔗 ${title}\n${url}`,
        contextInfo: {
          externalAdReply: {
            title,
            body: "Tap to open website",
            mediaType: 1,
            renderLargerThumbnail: true,
            showAdAttribution: false,
            sourceUrl: url,
            thumbnail: thumbBuf || undefined,
          },
        },
      };
      return await m.client.sendMessage(jid, msg, { quoted: m });
    }
  } catch {}

  // 3) Last fallback: plain text link (still clickable)
  return m.reply ? m.reply(`${title}\n${url}`) : null;
}

kord(
  { cmd: "linkcard|lcard|card|link", desc: "Premium clickable link card", fromMe: wtype, react: "🔗", type: "tools" },
  async (m, text) => {
    const pfx = SAFE_PREFIX();
    const raw = String(text || "").trim();

    if (!raw) {
      return m.reply
        ? m.reply(
            `🔗 *LinkCard*\n\nUse:\n• ${pfx}linkcard https://example.com\n• ${pfx}card example.com\n\nOptional:\n• ${pfx}setvar LINKCARD_THUMB=https://...jpg\n• ${pfx}setvar LINKCARD_TITLE=My Title`
          )
        : null;
    }

    const url = normalizeUrl(raw);
    const customTitle = getVar("LINKCARD_TITLE", "");
    const customThumb = getVar("LINKCARD_THUMB", "");

    let title = customTitle;
    if (!title) {
      const html = await fetchText(url);
      title = extractTitle(html) || "Website";
    }

    const thumbUrl =
      customThumb ||
      `https://image.thum.io/get/width/900/crop/700/${encodeURIComponent(url)}`;

    return await sendLinkCard(m, url, title, thumbUrl);
  }
);