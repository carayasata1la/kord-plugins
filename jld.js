/**
 * JustLetterDeploy (JLD) v3 — Secure URL -> Code Fetcher (NO AUTO-DUMP)
 *
 * Why v3:
 * - WhatsApp often CUTS long code messages => you get incomplete JS and "invalid plugin".
 * - v3 fetches + stores code safely, then you VIEW it in pages (never cut mid-send).
 *
 * Commands:
 * 1) jldpass <newpass>              -> set password (owner/mod)
 * 2) jld <url>                      -> fetch + store code (asks password)
 * 3) jldopen <id>                   -> show info + ready view commands
 * 4) jldview <id> <page>            -> show code page (text only)
 * 5) jldlink <id>                   -> show final resolved URL (one clean link)
 * 6) jldlist                         -> list saved items
 * 7) jlddel <id>                    -> delete saved item
 * 8) jldcancel                      -> cancel session
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const { kord, wtype, config, prefix } = require("../core");

/* ----------------- STORAGE ----------------- */
const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".jld");
const PASS_FILE = path.join(DATA_DIR, "pass.json");
const DB_FILE = path.join(DATA_DIR, "db.json");
const STORE_DIR = path.join(DATA_DIR, "store");

const TTL = 2 * 60 * 1000; // 2 min password window
const MAX_BYTES = 700 * 1024; // 700KB fetch limit (increase if you want)
const PAGE_CHARS = 2800; // safer than 3200 for WhatsApp

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }, null, 2));
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ items: {} }, null, 2));
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

function readDB() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { items: {} };
  }
}

function writeDB(db) {
  ensureDirs();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function makeId() {
  return crypto.randomBytes(4).toString("hex"); // short id
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
      : String(sudoRaw).split(",").map((x) => x.trim()).filter(Boolean);
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

/* ----------------- FETCH (with redirects + resolved url) ----------------- */
function fetchTextWithResolved(url, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    if (!isValidHttpUrl(url)) return reject(new Error("Invalid URL"));

    const lib = url.startsWith("https") ? https : http;

    const req = lib.get(url, (res) => {
      // redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchTextWithResolved(next, redirectsLeft - 1));
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

      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ text, resolvedUrl: url });
      });
    });

    req.on("error", reject);
  });
}

/* ----------------- SESSIONS ----------------- */
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

/* ----------------- VIEW HELPERS ----------------- */
function splitPages(text, size = PAGE_CHARS) {
  const out = [];
  const t = String(text || "");
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
  return out;
}

async function replyText(m, t) {
  return m.reply ? m.reply(t) : null;
}

/* ----------------- COMMANDS ----------------- */

// Set password
kord(
  { cmd: "jldpass", desc: "Set JLD password", fromMe: wtype, type: "tools", react: "🔐" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const pfx = SAFE_PREFIX();
    const pass = String(text || "").trim();
    if (!pass || pass.length < 4) {
      return replyText(m, `❌ Usage: ${pfx}jldpass <newpassword>\nMinimum 4 characters.`);
    }

    writePass(pass);
    return replyText(m, "✅ JLD password saved.");
  }
);

// Fetch + Store (asks password in next message)
kord(
  { cmd: "jld|justletterdeploy", desc: "Fetch code from URL (stores, no auto-dump)", fromMe: wtype, type: "tools", react: "📦" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const pfx = SAFE_PREFIX();
    const url = String(text || "").trim();
    const saved = readPass();

    if (!saved) {
      return replyText(m, `🔒 Password not set.\nSet it first:\n${pfx}jldpass <password>`);
    }
    if (!url || !isValidHttpUrl(url)) {
      return replyText(m, `❌ Usage:\n${pfx}jld <url>\nExample:\n${pfx}jld https://example.com/plugin.js`);
    }

    setSession(m, { mode: "await_pass", url });
    return replyText(
      m,
      `🔐 JLD Locked\nSend your password now (within ${Math.floor(TTL / 1000)}s).\nCancel: ${pfx}jldcancel`
    );
  }
);

// Cancel
kord(
  { cmd: "jldcancel", desc: "Cancel JLD session", fromMe: wtype, type: "tools", react: "❌" },
  async (m) => {
    if (!isAllowed(m)) return;
    clearSession(m);
    return replyText(m, "✅ JLD session cancelled.");
  }
);

// List stored items
kord(
  { cmd: "jldlist", desc: "List saved fetches", fromMe: wtype, type: "tools", react: "📚" },
  async (m) => {
    if (!isAllowed(m)) return;

    const db = readDB();
    const items = db.items || {};
    const keys = Object.keys(items);

    if (!keys.length) return replyText(m, "📭 JLD store is empty.");

    const lines = keys.slice(0, 30).map((id, i) => {
      const it = items[id];
      const name = (it?.name || "code").slice(0, 28);
      const size = it?.size || 0;
      return `${String(i + 1).padStart(2, "0")}) ${id}  (${Math.round(size / 1024)}KB)  ${name}`;
    });

    return replyText(m, `📚 JLD SAVED\n\n${lines.join("\n")}\n\nUse: ${SAFE_PREFIX()}jldopen <id>`);
  }
);

// Open item info
kord(
  { cmd: "jldopen", desc: "Show saved item info + how to view pages", fromMe: wtype, type: "tools", react: "🧾" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const id = String(text || "").trim();
    if (!id) return replyText(m, `❌ Usage: ${SAFE_PREFIX()}jldopen <id>`);

    const db = readDB();
    const it = db.items?.[id];
    if (!it) return replyText(m, `❌ Not found: ${id}`);

    return replyText(
      m,
      `🧾 JLD ITEM\n\n` +
        `ID: ${id}\n` +
        `Name: ${it.name}\n` +
        `Size: ${Math.round((it.size || 0) / 1024)}KB\n` +
        `Pages: ${it.pages}\n\n` +
        `View:\n${SAFE_PREFIX()}jldview ${id} 1\n\n` +
        `Link (clean resolved):\n${SAFE_PREFIX()}jldlink ${id}`
    );
  }
);

// View a page
kord(
  { cmd: "jldview", desc: "View saved code by page (text only)", fromMe: wtype, type: "tools", react: "🧩" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
    const id = parts[0];
    const page = parseInt(parts[1] || "1", 10);

    if (!id) return replyText(m, `❌ Usage: ${SAFE_PREFIX()}jldview <id> <page>`);

    const db = readDB();
    const it = db.items?.[id];
    if (!it) return replyText(m, `❌ Not found: ${id}`);

    const filePath = path.join(STORE_DIR, it.file);
    if (!fs.existsSync(filePath)) return replyText(m, `❌ Stored file missing for: ${id}`);

    const code = fs.readFileSync(filePath, "utf8");
    const pages = splitPages(code, PAGE_CHARS);
    const total = pages.length;
    const p = Math.max(1, Math.min(page || 1, total));

    const header = `JLD ${id} — Page ${p}/${total}\n`;
    const body = pages[p - 1] || "";
    const footer = `\n\nNext: ${SAFE_PREFIX()}jldview ${id} ${Math.min(total, p + 1)}`;

    // Text-only (code block wrapper is fine; page never exceeds limit)
    return replyText(m, "```js\n" + header + body + footer + "\n```");
  }
);

// Show resolved link only (one clean link)
kord(
  { cmd: "jldlink", desc: "Show resolved raw link for a saved item", fromMe: wtype, type: "tools", react: "🔗" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const id = String(text || "").trim();
    if (!id) return replyText(m, `❌ Usage: ${SAFE_PREFIX()}jldlink <id>`);

    const db = readDB();
    const it = db.items?.[id];
    if (!it) return replyText(m, `❌ Not found: ${id}`);

    return replyText(m, `🔗 Resolved URL:\n${it.resolvedUrl}`);
  }
);

// Delete saved item
kord(
  { cmd: "jlddel", desc: "Delete a saved item", fromMe: wtype, type: "tools", react: "🗑️" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const id = String(text || "").trim();
    if (!id) return replyText(m, `❌ Usage: ${SAFE_PREFIX()}jlddel <id>`);

    const db = readDB();
    const it = db.items?.[id];
    if (!it) return replyText(m, `❌ Not found: ${id}`);

    const filePath = path.join(STORE_DIR, it.file);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

    delete db.items[id];
    writeDB(db);

    return replyText(m, `✅ Deleted: ${id}`);
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
      return replyText(m, "🔒 Password not set anymore. Set again with jldpass.");
    }

    if (passTry !== saved) {
      return replyText(m, "❌ Wrong password. Try again or use jldcancel.");
    }

    // Verified: fetch + store
    const url = s.url;
    clearSession(m);

    await replyText(m, "✅ Password verified. Fetching + storing code (no auto-dump)...");

    const { text, resolvedUrl } = await fetchTextWithResolved(url);

    // store
    const id = makeId();
    const file = `${id}.js`;
    const filePath = path.join(STORE_DIR, file);

    fs.writeFileSync(filePath, text, "utf8");

    const pages = splitPages(text, PAGE_CHARS).length;

    const db = readDB();
    db.items = db.items || {};
    db.items[id] = {
      id,
      name: path.basename(new URL(resolvedUrl).pathname || "code.js") || "code.js",
      file,
      size: Buffer.byteLength(text, "utf8"),
      pages,
      resolvedUrl,
      createdAt: new Date().toISOString(),
      by: getSenderId(m),
    };
    writeDB(db);

    return replyText(
      m,
      `✅ Saved.\n\nID: ${id}\nPages: ${pages}\n\nView:\n${SAFE_PREFIX()}jldview ${id} 1\n\nClean link:\n${SAFE_PREFIX()}jldlink ${id}`
    );
  } catch (e) {
    try { clearSession(m); } catch {}
    return replyText(m, "❌ JLD failed: " + (e?.message || e));
  }
});