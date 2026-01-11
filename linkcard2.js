/**
 * PureLink (no screenshots)
 * Sends a clean clickable URL like normal WhatsApp link.
 *
 * cmd: link | plink | open | url
 * Usage:
 *   .link https://example.com
 *   .open example.com
 */

const { kord, wtype, prefix } = require("../core");

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

async function sendPlainLink(m, url) {
  // Try core .send first
  try {
    if (typeof m.send === "function") {
      // Just text, no thumbnail, no externalAdReply
      return await m.send(url, {}, "text");
    }
  } catch {}

  // Try direct baileys style sendMessage
  try {
    if (m?.client?.sendMessage) {
      const jid = m?.key?.remoteJid || m?.chat;
      return await m.client.sendMessage(jid, { text: url }, { quoted: m });
    }
  } catch {}

  // Last fallback
  return m.reply ? m.reply(url) : null;
}

kord(
  { cmd: "link|plink|open|url", desc: "Send a real clickable link (no screenshot preview)", fromMe: wtype, react: "🔗", type: "tools" },
  async (m, text) => {
    const pfx = SAFE_PREFIX();
    const raw = String(text || "").trim();
    if (!raw) {
      return m.reply ? m.reply(`Usage:\n• ${pfx}link https://example.com\n• ${pfx}open example.com`) : null;
    }
    const url = normalizeUrl(raw);
    return await sendPlainLink(m, url);
  }
);