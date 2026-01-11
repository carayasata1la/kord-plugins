/**
 * KORD CANVAS BOT MENU v5 (NAME + USER + BG + THEMES + FIXED)
 * Commands:
 *  - botmenu | bmenu
 *  - menucancel
 *
 * Reply flow:
 *  main: categories | config | cancel
 *  categories: reply category name OR next/back/home/cancel
 *  category cmds: next/back/categories/home/cancel
 *
 * setvar:
 *  - BOTMENU_NAME
 *  - BOTUSER_NAME
 *  - BOTMENU_THEME   (neon/ice/hacker/sunset/purple/gold)
 *  - MENU_IMAGE
 */

const { version } = require("../package.json");
const { prefix, kord, wtype, secondsToHms, config, commands } = require("../core");

let Canvas;
try {
  Canvas = require("canvas");
} catch (e) {
  Canvas = null;
}

const https = require("https");
const http = require("http");

/* ----------------- CONFIG ----------------- */
const DEFAULT_BG = "https://cdn.kord.live/serve/C9Lt7Cr94t3q.jpg";
const COPYRIGHT = "KORD";

/* ----------------- SESSIONS ---------------- */
const SESSIONS = new Map();
const TTL = 3 * 60 * 1000; // 3 minutes

function getSenderId(m) {
  return (
    m?.sender ||
    m?.key?.participant ||
    m?.participant ||
    m?.key?.remoteJid ||
    "unknown"
  );
}

function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}

function skey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}

function setSession(m, data) {
  SESSIONS.set(skey(m), { ...data, ts: Date.now() });
}

function getSession(m) {
  const k = skey(m);
  const s = SESSIONS.get(k);
  if (!s) return null;
  if (Date.now() - s.ts > TTL) {
    SESSIONS.delete(k);
    return null;
  }
  s.ts = Date.now();
  SESSIONS.set(k, s);
  return s;
}

function clearSession(m) {
  SESSIONS.delete(skey(m));
}

/* ---------------- CONFIG/VAR HELPERS ---------------- */
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

function getVar(name, fallback = "") {
  // env first
  const env = process.env?.[name];
  if (env !== undefined && env !== null) {
    const s = String(env).trim();
    if (s) return s;
  }
  // config() / config object
  const cfg = getCfgAny();
  const v = cfg?.[name];
  if (v !== undefined && v !== null) {
    const s = String(v).trim();
    if (s) return s;
  }
  return fallback;
}

function BOT_NAME_VALUE() {
  const cfg = getCfgAny();
  const v = cfg?.BOT_NAME;
  const s = v !== undefined && v !== null ? String(v).trim() : "";
  return s || "KORD";
}

function MENU_TITLE() {
  return getVar("BOTMENU_NAME", BOT_NAME_VALUE());
}

function BOTUSER_NAME() {
  return getVar("BOTUSER_NAME", "not set");
}

function BOTMENU_THEME() {
  return getVar("BOTMENU_THEME", "neon").toLowerCase();
}

function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return ".";
}

/* ---------------- ACCESS CONTROL ---------------- */
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

/* ---------------- TEXT HELPERS ---------------- */
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

function uniqSort(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

function buildCategories() {
  const cats = {};
  for (const c of commands || []) {
    if (!c?.cmd) continue;
    const primary = String(c.cmd).split("|")[0]?.trim();
    if (!primary) continue;
    const type = String(c.type || "other").toLowerCase();
    if (!cats[type]) cats[type] = [];
    cats[type].push(primary);
  }
  for (const k of Object.keys(cats)) cats[k] = uniqSort(cats[k]);
  return cats;
}

async function safeReact(m, emoji) {
  try {
    if (typeof m.react === "function") return await m.react(emoji);
  } catch {}
  try {
    if (typeof m.reaction === "function") return await m.reaction(emoji);
  } catch {}
  try {
    if (typeof m.sendReaction === "function") return await m.sendReaction(emoji);
  } catch {}
  return null;
}

/* ---------------- BG IMAGE ---------------- */
function menuBgUrl() {
  const v = getVar("MENU_IMAGE", "");
  return v ? v : DEFAULT_BG;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      lib
        .get(url, (res) => {
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
        })
        .on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

/* -------------- THEMES -------------- */
const THEMES = {
  neon:   { neon: "#27ff9a", dim: "#eafff6", border: "#1ccf7b", panel: "rgba(6, 24, 15, 0.72)" },
  ice:    { neon: "#7df3ff", dim: "#e8fbff", border: "#3ad7ff", panel: "rgba(6, 16, 24, 0.72)" },
  hacker: { neon: "#00ff66", dim: "#d8ffe9", border: "#00cc55", panel: "rgba(0, 14, 6, 0.78)" },
  sunset: { neon: "#ff8a3d", dim: "#fff0e6", border: "#ff5f2e", panel: "rgba(24, 10, 6, 0.74)" },
  purple: { neon: "#c77dff", dim: "#f4eaff", border: "#8a2be2", panel: "rgba(16, 6, 24, 0.74)" },
  gold:   { neon: "#ffd166", dim: "#fff7df", border: "#ffb703", panel: "rgba(24, 18, 6, 0.74)" },
};

function THEME_NOW() {
  const key = BOTMENU_THEME();
  return THEMES[key] || THEMES.neon;
}

/* -------------- CANVAS CARD -------------- */
async function makeCard({ title, lines = [], footer = COPYRIGHT, width = 900 }) {
  if (!Canvas) return null;

  const theme = THEME_NOW();
  const { createCanvas, loadImage } = Canvas;

  const padding = 40;
  const lineH = 34;
  const titleH = 62;
  const footerH = 46;
  const height = padding + titleH + 20 + lines.length * lineH + 20 + footerH + padding;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // background image
  try {
    const bgBuf = await fetchBuffer(menuBgUrl());
    const img = await loadImage(bgBuf);

    const scale = Math.max(width / img.width, height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  } catch {
    ctx.fillStyle = "#06130d";
    ctx.fillRect(0, 0, width, height);
  }

  // overlay
  ctx.fillStyle = "rgba(0,0,0,0.50)";
  ctx.fillRect(0, 0, width, height);

  // border
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  // panel
  ctx.fillStyle = theme.panel;
  ctx.fillRect(30, 30, width - 60, height - 60);

  // scanlines
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < height; y += 6) ctx.fillRect(0, y, width, 1);
  ctx.globalAlpha = 1;

  // title
  ctx.font = "bold 38px Sans";
  ctx.fillStyle = theme.neon;
  ctx.fillText(title, padding, padding + 42);

  // divider
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padding, padding + 62);
  ctx.lineTo(width - padding, padding + 62);
  ctx.stroke();

  // body
  ctx.font = "24px Sans";
  ctx.fillStyle = theme.dim;

  let y = padding + 62 + 40;
  for (const ln of lines) {
    ctx.fillText(String(ln), padding, y);
    y += lineH;
  }

  // footer
  ctx.font = "22px Sans";
  ctx.fillStyle = theme.neon;
  ctx.fillText(footer, padding, height - padding);

  return canvas.toBuffer("image/png");
}

/* -------------- SEND IMAGE (SAFE) -------------- */
async function sendImage(m, buffer, caption = "") {
  try {
    if (typeof m.send === "function") {
      return await m.send(buffer, { caption }, "image");
    }
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      const jid = getChatId(m);
      return await m.client.sendMessage(jid, { image: buffer, caption }, { quoted: m });
    }
  } catch {}
  return m.reply ? m.reply(caption || "OK") : null;
}

/* -------------- PAGING -------------- */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* -------------- SCREENS -------------- */
async function showMainMenu(m) {
  const up = await secondsToHms(process.uptime());
  const ramMB = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;

  const cfg = getCfgAny();
  const owner = cfg?.OWNER_NAME ? String(cfg.OWNER_NAME).trim() : "OWNER";
  const host = cfg?.client?.platform || "pterodactyl(panel)";
  const totalCmds = Array.isArray(commands) ? commands.length : 0;

  const title = `${MENU_TITLE()} BOT MENU`;

  const lines = [
    `✪✪ Owner : ${owner}`,
    `✪✪ User  : ${BOTUSER_NAME()}`,
    `✪✪ Cmds  : ${totalCmds}`,
    `✪✪ Uptime: ${up}`,
    `✪✪ RAM   : ${ramMB} MB`,
    `✪✪ Ver   : v${version}`,
    `✪✪ Host  : ${host}`,
    "",
    "Reply with:",
    "categories -> show categories",
    "config -> menu config",
    "cancel -> close",
  ];

  const img = await makeCard({ title, lines, footer: COPYRIGHT });
  setSession(m, { mode: "main" });
  await safeReact(m, "🧑‍💻");

  if (!img) return m.reply ? m.reply("❌ Canvas not available. Install: npm i canvas") : null;
  return sendImage(m, img, "Reply: categories / config / cancel");
}

async function showConfig(m) {
  const pfx = SAFE_PREFIX();
  const lines = [
    `BOT_NAME      : ${BOT_NAME_VALUE()}`,
    `BOTMENU_NAME  : ${MENU_TITLE()}`,
    `BOTUSER_NAME  : ${BOTUSER_NAME()}`,
    `PREFIX        : ${pfx}`,
    `MENU_IMAGE    : ${getVar("MENU_IMAGE", "") ? "SET" : "DEFAULT"}`,
    `BOTMENU_THEME : ${BOTMENU_THEME()}`,
    "",
    "Change menu title:",
    `${pfx}setvar BOTMENU_NAME=Kord Bot`,
    "Change user label:",
    `${pfx}setvar BOTUSER_NAME=CRYSNOVA`,
    "Change background:",
    `${pfx}setvar MENU_IMAGE=https://...jpg`,
    "Change theme:",
    `${pfx}setvar BOTMENU_THEME=neon`,
    "Themes: neon, ice, hacker, sunset, purple, gold",
    "",
    "Reply: home / cancel",
  ];

  const img = await makeCard({ title: "BOTMENU CONFIG", lines, footer: COPYRIGHT });
  setSession(m, { mode: "config" });
  await safeReact(m, "⚙️");

  if (!img) return m.reply ? m.reply("❌ Canvas not available. Install: npm i canvas") : null;
  return sendImage(m, img, "Reply: home / cancel");
}

async function showCategories(m, page = 0) {
  const cats = buildCategories();
  const keys = Object.keys(cats).sort((a, b) => a.localeCompare(b));
  const pages = chunk(keys, 16);

  const p = Math.max(0, Math.min(page, pages.length - 1));
  const list = pages[p] || [];

  const lines = [
    "Reply category name to open:",
    "",
    ...list.map((k, i) => {
      const n = String(p * 16 + i + 1).padStart(2, "0");
      const c = String(cats[k].length).padStart(2, "0");
      return `${n}) ${k} (${c})`;
    }),
    "",
    `Page: ${p + 1}/${Math.max(1, pages.length)}`,
    "Controls: next / back / home / cancel",
    "Example: ai",
  ];

  const img = await makeCard({ title: "BOTMENU CATEGORIES", lines, footer: COPYRIGHT });
  setSession(m, { mode: "cats", page: p });
  await safeReact(m, "📜");

  if (!img) return m.reply ? m.reply("❌ Canvas not available. Install: npm i canvas") : null;
  return sendImage(m, img, "Reply category name, or next/back/home/cancel");
}

async function showCategoryCommands(m, catName, page = 0) {
  const cats = buildCategories();
  const keys = Object.keys(cats).sort((a, b) => a.localeCompare(b));
  const foundKey = keys.find((k) => k.toLowerCase() === String(catName).toLowerCase());

  if (!foundKey) {
    const img = await makeCard({
      title: "CATEGORY NOT FOUND",
      lines: [
        `No category named: ${catName}`,
        "",
        "Reply: categories",
        "Reply: home",
        "Reply: cancel",
      ],
      footer: COPYRIGHT,
    });
    setSession(m, { mode: "main" });
    await safeReact(m, "⚠️");
    return img ? sendImage(m, img, "Reply: categories / home / cancel") : (m.reply ? m.reply("Category not found.") : null);
  }

  const all = cats[foundKey] || [];
  const pages = chunk(all, 22);

  const p = Math.max(0, Math.min(page, pages.length - 1));
  const list = pages[p] || [];

  const pfx = SAFE_PREFIX();

  const lines = [
    `Category: ${foundKey.toUpperCase()}`,
    `Total cmds: ${all.length}`,
    "",
    ...list.map((c, i) => `${String(p * 22 + i + 1).padStart(2, "0")}) ${pfx}${c}`),
    "",
    `Page: ${p + 1}/${Math.max(1, pages.length)}`,
    "Controls: next / back / categories / home / cancel",
  ];

  const img = await makeCard({ title: "CATEGORY COMMANDS", lines, footer: COPYRIGHT });
  setSession(m, { mode: "catcmds", cat: foundKey, page: p });
  await safeReact(m, "📁");

  if (!img) return m.reply ? m.reply("❌ Canvas not available. Install: npm i canvas") : null;
  return sendImage(m, img, `Opened: ${foundKey} (reply next/back)`);
}

/* -------------- COMMANDS -------------- */
kord(
  { cmd: "botmenu|bmenu", desc: "Canvas image bot menu", fromMe: wtype, react: "🧑‍💻", type: "help" },
  async (m) => {
    try {
      if (!isAllowed(m)) return;
      return await showMainMenu(m);
    } catch (e) {
      return m.reply ? m.reply("❌ botmenu failed: " + (e?.message || e)) : null;
    }
  }
);

kord(
  { cmd: "menucancel", desc: "Cancel menu session", fromMe: wtype, react: "❌", type: "help" },
  async (m) => {
    if (!isAllowed(m)) return;
    clearSession(m);
    await safeReact(m, "❌");
    const img = await makeCard({ title: "MENU CLOSED", lines: ["Session ended."], footer: COPYRIGHT });
    return img ? sendImage(m, img, "Closed") : (m.reply ? m.reply("Menu closed") : null);
  }
);

/* -------------- SESSION LISTENER -------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;

    const s = getSession(m);
    if (!s) return;

    const raw = getTextFromAny(m, textArg).trim();
    if (!raw) return;

    const input = raw.toLowerCase();

    if (["cancel", "menucancel", "close", "exit"].includes(input)) {
      clearSession(m);
      await safeReact(m, "❌");
      const img = await makeCard({ title: "MENU CLOSED", lines: ["Session ended."], footer: COPYRIGHT });
      return img ? sendImage(m, img, "Closed") : (m.reply ? m.reply("Menu closed") : null);
    }

    if (input === "home") return await showMainMenu(m);

    if (s.mode === "main") {
      if (input === "categories" || input === "menucats") return await showCategories(m, 0);
      if (input === "config" || input === "menuconfig") return await showConfig(m);
      return;
    }

    if (s.mode === "config") {
      if (input === "categories" || input === "menucats") return await showCategories(m, 0);
      if (input === "config" || input === "menuconfig") return await showConfig(m);
      return;
    }

    if (s.mode === "cats") {
      if (input === "next") return await showCategories(m, (s.page || 0) + 1);
      if (input === "back") return await showCategories(m, (s.page || 0) - 1);
      if (input === "config" || input === "menuconfig") return await showConfig(m);
      if (input === "categories" || input === "menucats") return await showCategories(m, s.page || 0);

      return await showCategoryCommands(m, raw, 0);
    }

    if (s.mode === "catcmds") {
      if (input === "next") return await showCategoryCommands(m, s.cat, (s.page || 0) + 1);
      if (input === "back") return await showCategoryCommands(m, s.cat, (s.page || 0) - 1);
      if (input === "categories" || input === "menucats") return await showCategories(m, 0);
      if (input === "home") return await showMainMenu(m);
      return;
    }
  } catch (e) {
    // silent
  }
});