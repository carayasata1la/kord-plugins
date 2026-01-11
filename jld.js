/**
 * JustLetterDeploy (JLD) - Secure URL -> Code Fetcher (TEXT ONLY)
 *
 * Commands:
 *  - jld <url>              -> request code from URL (asks password)
 *  - jldpass <newpassword>  -> set password (owner/mod only)
 *  - jldcancel              -> cancel session
 *
 * Notes:
 *  - TEXT ONLY: never sends as file/document
 *  - DOES NOT execute code. Only fetches and returns.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const { kord, wtype, config, prefix } = require("../core");

/* ----------------- SETTINGS ----------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".jld");
const PASS_FILE = path.join(DATA_DIR, "pass.json");

const TTL = 2 * 60 * 1000; // 2 minutes
const MAX_BYTES = 450 * 1024; // 450KB fetch limit
const CHUNK = 3200; // message chunk size (safe)

/* ----------------- FILE DB ----------------- */
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }, null, 2));
}
function readPass() {
  ensureDirs();
  try {
    const j = JSON.parse(fs.readFileSync(PASS_FILE, "utf8"));
    return String(j.pass || "").trim();
  } catch {
    return "";
  }
}
function writePass(p) {
  ensureDirs();
  fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: String(p || "").trim() }, null, 2));
}

/* ----------------- CORE SAFE ----------------- */
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

function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}
function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}

function isAllowed(m) {
  if (m?.fromMe) return true;
  if (m?.isOwner) return true;
  if (m?.isSudo) return true;
  if (m?.isMod) return true;

  const cfg = getCfgAny();
  const sudoRaw = cfg?.SUDO || cfg?.SUDO_USERS || cfg?.SUDOS;
  const sender = getSenderId(m);

  if (sudoRaw && sender) {
    const list = Array.isArray(sudoRaw)
      ? sudoRaw
      : String(sudoRaw)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/* ----------------- FETCH (redirect safe) ----------------- */
function fetchText(url, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    if (!isValidHttpUrl(url)) return reject(new Error("Invalid URL"));

    const lib = url.startsWith("https") ? https : http;

    const req = lib.get(url, (res) => {
      // redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchText(next, redirectsLeft - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const chunks = [];
      let size = 0;

      res.on("data", (d) => {
        size += d.length;
        if (size > MAX_BYTES) {
          req.destroy();
          return reject(new Error(`File too large (>${Math.floor(MAX_BYTES / 1024)}KB)`));
        }
        chunks.push(d);
      });

      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

    req.on("error", reject);
  });
}

/* ----------------- TEXT SEND (NO FILES) ----------------- */
async function sendCodeAsText(m, code) {
  const txt = String(code || "");
  if (!txt.trim()) return m.reply ? m.reply("❌ Empty response") : null;

  // nice header first
  if (m.reply) await m.reply(`✅ Code fetched (${txt.length} chars). Sending as text...`);

  // split safely
  for (let i = 0; i < txt.length; i += CHUNK) {
    const part = txt.slice(i, i + CHUNK);
    const block = "```js\n" + part + "\n```";
    if (m.reply) await m.reply(block);
  }
  return null;
}

/* ----------------- SESSION ----------------- */
const SESS = new Map();

function skey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}
function setSession(m, data) {
  SESS.set(skey(m), { ...data, ts: Date.now() });
}
function getSession(m) {
  const s = SESS.get(skey(m));
  if (!s) return null;
  if (Date.now() - s.ts > TTL) {
    SESS.delete(skey(m));
    return null;
  }
  s.ts = Date.now();
  SESS.set(skey(m), s);
  return s;
}
function clearSession(m) {
  SESS.delete(skey(m));
}

/* ----------------- COMMANDS ----------------- */

// set password
kord(
  { cmd: "jldpass", desc: "Set JLD password", fromMe: wtype, type: "tools", react: "🔐" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const pfx = SAFE_PREFIX();
    const pass = String(text || "").trim();

    if (!pass || pass.length < 4) {
      return m.reply ? m.reply(`❌ Usage: ${pfx}jldpass <newpassword>\nMinimum 4 characters.`) : null;
    }

    writePass(pass);
    return m.reply ? m.reply("✅ JLD password saved.") : null;
  }
);

// start fetch
kord(
  { cmd: "jld|justletterdeploy", desc: "Fetch code from URL (password required)", fromMe: wtype, type: "tools", react: "📦" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const pfx = SAFE_PREFIX();
    const url = String(text || "").trim();

    const saved = readPass();
    if (!saved) {
      return m.reply ? m.reply(`🔒 Password not set.\nSet it first:\n${pfx}jldpass <password>`) : null;
    }

    if (!url || !isValidHttpUrl(url)) {
      return m.reply
        ? m.reply(
            `❌ Usage:\n${pfx}jld <url>\n\nExample:\n${pfx}jld https://kord-plugins.pages.dev/botmenu.js`
          )
        : null;
    }

    setSession(m, { mode: "await_pass", url });
    return m.reply
      ? m.reply(
          `🔐 JLD Locked\n\nSend your password now.\n(Reply within ${Math.floor(TTL / 1000)}s)\n\nCancel: ${pfx}jldcancel`
        )
      : null;
  }
);

// cancel
kord(
  { cmd: "jldcancel", desc: "Cancel JLD session", fromMe: wtype, type: "tools", react: "❌" },
  async (m) => {
    if (!isAllowed(m)) return;
    clearSession(m);
    return m.reply ? m.reply("✅ JLD session cancelled.") : null;
  }
);

/* ----------------- LISTENER (password input) ----------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;

    const s = getSession(m);
    if (!s || s.mode !== "await_pass") return;

    const raw =
      (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      "";

    const passTry = String(raw || "").trim();
    if (!passTry) return;

    const saved = readPass();
    if (!saved) {
      clearSession(m);
      return m.reply ? m.reply("🔒 Password not set anymore. Set again with jldpass.") : null;
    }

    if (passTry !== saved) {
      return m.reply ? m.reply("❌ Wrong password. Try again or use jldcancel.") : null;
    }

    // correct
    const url = s.url;
    clearSession(m);

    if (m.reply) await m.reply("✅ Password verified. Fetching code...");

    const code = await fetchText(url);
    return await sendCodeAsText(m, code);
  } catch (e) {
    try {
      clearSession(m);
    } catch {}
    return m.reply ? m.reply("❌ JLD failed: " + (e?.message || e)) : null;
  }
});