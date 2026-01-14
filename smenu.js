/* [SMENU v1 — PART 1 / 3]
 * Premium Slide Menu (NO canvas)
 * Cmd: smenu
 *
 * Requirements:
 * - No extra packages needed
 *
 * Features:
 * - .smenu              => send all pages (4+)
 * - .smenu <n>          => send a single page
 * - .smenu next|prev    => navigate pages per chat
 * - .smenu settitle <t> => change title
 * - .smenu setbanner <url> => change banner image url
 * - .smenu setpages <4-10> => set number of pages
 * - .smenu reset        => reset settings for this chat
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config, prefix } = require("../core");

/* ---------------- SAFE CONFIG ---------------- */
function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
}
function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  const cfg = getCfgAny();
  if (cfg?.PREFIX && String(cfg.PREFIX).trim()) return String(cfg.PREFIX).trim();
  return ".";
}
function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}
function getTextFromAny(m, textArg) {
  const t =
    (typeof textArg === "string" ? textArg : "") ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text ||
    m?.body ||
    "";
  return String(t || "");
}
async function sendText(m, txt) {
  try { if (typeof m.reply === "function") return await m.reply(txt); } catch {}
  try { if (typeof m.send === "function") return await m.send(txt); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text: txt }, { quoted: m });
    }
  } catch {}
  return null;
}
async function sendImageUrl(m, url, caption) {
  // Send an image by URL (Baileys supports { image: { url } })
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(
        getChatId(m),
        { image: { url }, caption: caption || "" },
        { quoted: m }
      );
    }
  } catch {}
  // fallback: just send the url
  return sendText(m, (caption ? caption + "\n" : "") + url);
}

/* ---------------- STORAGE ---------------- */
const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".smenu");
const PREF_FILE = path.join(DATA_DIR, "prefs.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PREF_FILE)) {
    fs.writeFileSync(PREF_FILE, JSON.stringify({ chats: {} }, null, 2), "utf8");
  }
}
function readJSON(file, fallback) {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, obj) {
  ensureStore();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
function chatKey(m) {
  return String(getChatId(m));
}
function getChatPrefs(m) {
  const db = readJSON(PREF_FILE, { chats: {} });
  return db.chats[chatKey(m)] || {};
}
function setChatPrefs(m, patch) {
  const db = readJSON(PREF_FILE, { chats: {} });
  const k = chatKey(m);
  db.chats[k] = { ...(db.chats[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.chats[k];
}
function resetChatPrefs(m) {
  const db = readJSON(PREF_FILE, { chats: {} });
  delete db.chats[chatKey(m)];
  writeJSON(PREF_FILE, db);
}

/* ---------------- DEFAULTS ---------------- */
function defaults(m) {
  const cfg = getCfgAny();
  const botName = cfg?.BOT_NAME || cfg?.BOTNAME || "SMENU";
  const owner = cfg?.OWNER_NAME || cfg?.OWNERNAME || "Owner";
  const p = SAFE_PREFIX();
  return {
    title: String(botName || "SMENU").toUpperCase(),
    owner: String(owner),
    banner:
      process.env.SMENU_BANNER ||
      "https://i.imgur.com/0rGfZjT.jpeg", // replace anytime with .smenu setbanner
    pages: Math.max(4, Math.min(10, parseInt(process.env.SMENU_PAGES || "4", 10) || 4)),
    lastPage: 1,
    prefix: p
  };
}
function getState(m) {
  const d = defaults(m);
  const s = getChatPrefs(m);
  return {
    title: s.title || d.title,
    banner: s.banner || d.banner,
    pages: Math.max(4, Math.min(10, parseInt(s.pages || d.pages, 10) || 4)),
    lastPage: Math.max(1, parseInt(s.lastPage || d.lastPage, 10) || 1),
  };
}
function setLastPage(m, n) {
  setChatPrefs(m, { lastPage: n });
}

/* [SMENU v1 — PART 1 END] */
/* [SMENU v1 — PART 2 / 3] */

/* ---------------- MENU CONTENT ----------------
   Edit these categories to match your bot.
   Pages are generated dynamically based on page number.
----------------------------------------------- */
function pageCaption(m, page, total) {
  const st = getState(m);
  const p = SAFE_PREFIX();

  // You can customize the text blocks below:
  const blocks = {
    1: [
      `🎛️ ${st.title}`,
      `━━━━━━━━━━━━━━`,
      `📌 PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      ``,
      `🧭 Quick`,
      `• ${p}smenu`,
      `• ${p}smenu 2`,
      `• ${p}smenu next | prev`,
      ``,
      `⚙️ Settings`,
      `• ${p}smenu settitle <text>`,
      `• ${p}smenu setbanner <url>`,
      `• ${p}smenu setpages <4-10>`,
      `• ${p}smenu reset`,
    ],
    2: [
      `💎 ${st.title} — MAIN`,
      `━━━━━━━━━━━━━━`,
      `📌 PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      ``,
      `🧩 Core`,
      `• ${p}ping`,
      `• ${p}alive`,
      `• ${p}menu`,
      ``,
      `🛠 Tools`,
      `• ${p}calc <expr>`,
      `• ${p}profile`,
      `• ${p}runtime`,
    ],
    3: [
      `🧠 ${st.title} — AI`,
      `━━━━━━━━━━━━━━`,
      `📌 PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      ``,
      `🤖 AI Modes`,
      `• ${p}crysnova chat <msg>`,
      `• ${p}crysnova writer <topic>`,
      `• ${p}crysnova coder <bug>`,
      `• ${p}crysnova summarize (reply)`,
      ``,
      `🎯 Auto`,
      `• ${p}crysnova on`,
      `• ${p}crysnova mode tag|all`,
      `• ${p}crysnova off`,
    ],
    4: [
      `🎞️ ${st.title} — MEDIA`,
      `━━━━━━━━━━━━━━`,
      `📌 PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      ``,
      `🖼 Downloads`,
      `• ${p}ig <url>`,
      `• ${p}tt <url>`,
      `• ${p}yt <url>`,
      ``,
      `🎧 Audio`,
      `• ${p}song <name>`,
      `• ${p}voice <text>`,
    ],
  };

  // For pages 5..10 (if user sets more pages), repeat a clean “Extras” layout:
  if (!blocks[page]) {
    blocks[page] = [
      `✨ ${st.title} — EXTRAS`,
      `━━━━━━━━━━━━━━`,
      `📌 PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      ``,
      `📦 More Commands`,
      `• ${p}tools`,
      `• ${p}fun`,
      `• ${p}admin`,
      ``,
      `🧭 Navigation`,
      `• ${p}smenu prev`,
      `• ${p}smenu next`,
    ];
  }

  return blocks[page].join("\n");
}

function normalizeUrl(u) {
  u = String(u || "").trim();
  if (!u) return "";
  // allow http/https only
  if (!/^https?:\/\//i.test(u)) return "";
  return u;
}

/* ---------------- MAIN SENDERS ---------------- */
async function sendAllPages(m) {
  const st = getState(m);
  const total = st.pages;
  const banner = st.banner;

  // Send pages 1..N as separate image messages.
  // On WhatsApp they appear like a “slide/album feel” when sent consecutively.
  for (let i = 1; i <= total; i++) {
    const cap = pageCaption(m, i, total);
    await sendImageUrl(m, banner, cap);
  }
  setLastPage(m, 1);
}

async function sendOnePage(m, page) {
  const st = getState(m);
  const total = st.pages;
  const p = Math.max(1, Math.min(total, page));
  const cap = pageCaption(m, p, total);
  await sendImageUrl(m, st.banner, cap);
  setLastPage(m, p);
}

/* [SMENU v1 — PART 2 END] */
/* [SMENU v1 — PART 3 / 3] */

/* ---------------- COMMAND ROUTER ---------------- */
kord(
  {
    cmd: "smenu",
    desc: "Premium slide menu (title + banner changeable)",
    fromMe: wtype,
    type: "tools",
    react: "🖼️",
  },
  async (m, textArg) => {
    try {
      const raw = getTextFromAny(m, textArg).trim();
      const parts = raw.split(/\s+/).filter(Boolean); // ["smenu", ...]
      const sub = (parts[1] || "").toLowerCase();
      const rest = parts.slice(2).join(" ").trim();
      const p = SAFE_PREFIX();

      // No args => send all pages
      if (!sub) {
        return sendAllPages(m);
      }

      // Navigation
      if (sub === "next" || sub === "prev") {
        const st = getState(m);
        const cur = st.lastPage || 1;
        const next = sub === "next" ? cur + 1 : cur - 1;
        const page = Math.max(1, Math.min(st.pages, next));
        return sendOnePage(m, page);
      }

      // Set title
      if (sub === "settitle") {
        if (!rest) return sendText(m, `Use: ${p}smenu settitle <text>`);
        const title = rest.slice(0, 32);
        setChatPrefs(m, { title });
        return sendText(m, `✅ SMENU title set to: ${title}`);
      }

      // Set banner
      if (sub === "setbanner") {
        const url = normalizeUrl(rest);
        if (!url) return sendText(m, `Use: ${p}smenu setbanner https://... (must be http/https)`);
        setChatPrefs(m, { banner: url });
        return sendText(m, `✅ SMENU banner updated.`);
      }

      // Set pages
      if (sub === "setpages") {
        const n = parseInt(rest, 10);
        if (!Number.isFinite(n)) return sendText(m, `Use: ${p}smenu setpages <4-10>`);
        const pages = Math.max(4, Math.min(10, n));
        setChatPrefs(m, { pages });
        return sendText(m, `✅ SMENU pages set: ${pages}`);
      }

      // Reset
      if (sub === "reset") {
        resetChatPrefs(m);
        return sendText(m, `✅ SMENU reset for this chat.`);
      }

      // If sub is a number => send that page
      if (/^\d+$/.test(sub)) {
        const n = parseInt(sub, 10);
        return sendOnePage(m, n);
      }

      // Help
      return sendText(
        m,
        [
          `SMENU Help`,
          `• ${p}smenu`,
          `• ${p}smenu 2`,
          `• ${p}smenu next | prev`,
          ``,
          `Settings`,
          `• ${p}smenu settitle <text>`,
          `• ${p}smenu setbanner <url>`,
          `• ${p}smenu setpages <4-10>`,
          `• ${p}smenu reset`,
        ].join("\n")
      );
    } catch (e) {
      return sendText(m, "❌ SMENU error: " + (e?.message || e));
    }
  }
);

module.exports = {};

/* [SMENU v1 — PART 3 END] */