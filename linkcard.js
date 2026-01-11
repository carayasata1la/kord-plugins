/**
 * ==========================================================
 *  LINKSHIELD PRO v1 — Clean Clickable Link Cards (No extra npm)
 *  File: /home/container/cmds/linkshield|lshield.js
 * ==========================================================
 *
 * Commands:
 *   - linkshield <url>        -> Generates a clickable card that opens the URL
 *   - lshield <url>           -> alias
 *   - linkshield help         -> help screen
 *
 * How it works:
 *   - Fetches basic metadata (title) from the site (best-effort)
 *   - Generates a thumbnail using thum.io (best-effort)
 *   - Sends a WhatsApp "externalAdReply" card with sourceUrl = your link
 *
 * No extra packages needed.
 */

const https = require("https");
const http = require("http");
const { kord, wtype, prefix, config } = require("../core");

/* ------------------------- Utils ------------------------- */

function getCfgAny() {
  try {
    if (typeof config === "function") return config() || {};
  } catch {}
  try {
    return config || {};
  } catch {
    return {};
  }
}

function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return ".";
}

function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function extractFirstUrl(text) {
  if (!text) return "";
  const s = String(text);
  const m = s.match(/https?:\/\/[^\s<>"'`]+/i);
  return m ? m[0] : "";
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "website";
  }
}

function cleanTitle(t, fallback) {
  const x = String(t || "").replace(/\s+/g, " ").trim();
  if (!x) return fallback;
  // Avoid mega titles
  return x.length > 64 ? x.slice(0, 61) + "..." : x;
}

function fetchBuffer(url, maxBytes = 800_000) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith("https:") ? https : http;
      const req = lib.get(url, (res) => {
        // follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          return resolve(fetchBuffer(next, maxBytes));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }

        const chunks = [];
        let size = 0;

        res.on("data", (d) => {
          size += d.length;
          if (size > maxBytes) {
            req.destroy();
            return reject(new Error("Too large"));
          }
          chunks.push(d);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
      });

      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchTitleFromPage(url) {
  // best-effort: read small html and regex <title>
  try {
    const htmlBuf = await fetchBuffer(url, 500_000);
    const html = htmlBuf.toString("utf8");
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return "";
    return m[1].replace(/<[^>]+>/g, "").trim();
  } catch {
    return "";
  }
}

function thumIoThumb(url) {
  // Public thumbnail. Works for many sites, not guaranteed.
  // You can swap providers later if you want.
  const encoded = encodeURIComponent(url);
  return `https://image.thum.io/get/width/800/${encoded}`;
}

/* --------------------- Sender (Card) --------------------- */

async function sendLinkCard(m, url) {
  const host = domainOf(url);
  const fallbackTitle = host.toUpperCase();

  const title = cleanTitle(await fetchTitleFromPage(url), fallbackTitle);
  const body = `Tap to open • ${host}`;

  // Try thumbnail
  let thumb = null;
  try {
    thumb = await fetchBuffer(thumIoThumb(url), 900_000);
  } catch {
    thumb = null;
  }

  // The magic: externalAdReply makes a clickable preview card.
  // Clicking usually opens sourceUrl in WhatsApp browser.
  const text = `🔗 *LINKSHIELD PRO*\n${title}\n_${body}_`;

  const msg = {
    text,
    contextInfo: {
      externalAdReply: {
        title,
        body,
        thumbnail: thumb || undefined,
        mediaType: 1,
        renderLargerThumbnail: true,
        showAdAttribution: false,
        sourceUrl: url,
      },
    },
  };

  // Send via client (most reliable)
  const jid = getChatId(m);
  if (m?.client?.sendMessage) return m.client.sendMessage(jid, msg, { quoted: m });

  // Fallback
  if (typeof m.reply === "function") return m.reply(text);
  return null;
}

/* ------------------------ Command ------------------------ */

kord(
  {
    cmd: "linkshield|lshield",
    desc: "Generate a clean clickable link card (title + thumbnail).",
    fromMe: wtype, // respects your bot's default permission mode
    type: "tools",
    react: "🔗",
  },
  async (m, text) => {
    try {
      const pfx = SAFE_PREFIX();

      const raw = String(text || "").trim();
      if (!raw || raw.toLowerCase() === "help") {
        return m.reply(
          `🛡️ *LINKSHIELD PRO*\n\n` +
            `Usage:\n` +
            `• ${pfx}linkshield https://example.com\n` +
            `• ${pfx}lshield https://example.com\n\n` +
            `Tip:\n` +
            `You can also paste a sentence containing a URL and it will pick the first link.\n`
        );
      }

      const url = isValidHttpUrl(raw) ? raw : extractFirstUrl(raw);
      if (!url || !isValidHttpUrl(url)) {
        return m.reply(
          `❌ Invalid link.\n\n` +
            `Example:\n` +
            `${pfx}linkshield https://example.com`
        );
      }

      return await sendLinkCard(m, url);
    } catch (e) {
      console.log("[linkshield] error:", e);
      return m.reply ? m.reply("❌ linkshield failed: " + (e?.message || "unknown")) : null;
    }
  }
);