/**
 * KORD CHEATSHEET v1 (CS) — Never forget your commands again
 * File: /home/container/cmds/cheatsheet|cs.js
 *
 * Commands:
 *  - cs                       -> show categories + quick stats
 *  - cs <category>            -> list commands in a category
 *  - cs find <query>          -> search command/category
 *  - cs fav                   -> show favorites
 *  - cs fav add <cmd>         -> add favorite
 *  - cs fav del <cmd>         -> remove favorite
 *  - cs export                -> export full cheatsheet (auto-split)
 *
 * Requirements: none
 */

const fs = require("fs");
const path = require("path");

const { kord, wtype, config, prefix, commands } = require("../core");

const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".cheatsheet");
const DB_FILE = path.join(DATA_DIR, "db.json");

const CHUNK = 3200; // safe WhatsApp chunk

/* ---------------- safe utils ---------------- */
function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ fav: [] }, null, 2));
}
function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { fav: [] };
  }
}
function writeDB(db) {
  ensureDB();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
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

function uniqSort(a) {
  return [...new Set(a)].sort((x, y) => x.localeCompare(y));
}

function normalizeCmd(cmd) {
  return String(cmd || "").split("|")[0].trim();
}

function buildIndex() {
  const cats = {}; // type -> [cmd]
  const meta = {}; // cmd -> { type, desc }
  for (const c of commands || []) {
    if (!c || !c.cmd) continue;
    const type = String(c.type || "other").toLowerCase();
    const cmd = normalizeCmd(c.cmd);
    if (!cmd) continue;

    if (!cats[type]) cats[type] = [];
    cats[type].push(cmd);

    meta[cmd] = { type, desc: String(c.desc || "").trim() };
  }
  for (const k of Object.keys(cats)) cats[k] = uniqSort(cats[k]);
  return { cats, meta };
}

async function sendLong(m, text) {
  const parts = [];
  let s = String(text || "");
  while (s.length > CHUNK) {
    parts.push(s.slice(0, CHUNK));
    s = s.slice(CHUNK);
  }
  if (s) parts.push(s);

  for (let i = 0; i < parts.length; i++) {
    const head = parts.length > 1 ? `(${i + 1}/${parts.length})\n` : "";
    if (m.reply) await m.reply(head + parts[i]);
  }
}

/* ---------------- formatting ---------------- */
function header(title) {
  return `┏▣ ◈ *${title}* ◈\n`;
}
function footer() {
  return "┗▣";
}
function bullet(x) {
  return `│➽ ${x}`;
}

function formatCategoryList(cats, pfx, favCount) {
  const keys = Object.keys(cats).sort((a, b) => a.localeCompare(b));
  const total = keys.reduce((n, k) => n + (cats[k]?.length || 0), 0);

  const top = [
    `┃ *prefix* : [ ${pfx} ]`,
    `┃ *categories* : ${keys.length}`,
    `┃ *commands* : ${total}`,
    `┃ *favorites* : ${favCount}`,
  ];

  let out = header("CHEATSHEET");
  out += top.map((x) => x + "\n").join("");
  out += "┗▣\n\n";

  out += header("CATEGORIES");
  for (const k of keys) out += bullet(`${k}  (${cats[k].length})`) + "\n";
  out += footer() + "\n\n";

  out += header("HOW TO USE");
  out += bullet(`${pfx}cs <category>`) + "\n";
  out += bullet(`${pfx}cs find <word>`) + "\n";
  out += bullet(`${pfx}cs fav`) + "\n";
  out += bullet(`${pfx}cs export`) + "\n";
  out += footer();

  return out;
}

function formatCommandsInCategory(cat, list, pfx, meta) {
  let out = header(`${cat.toUpperCase()} MENU`);
  for (const c of list) {
    const d = meta[c]?.desc ? ` — ${meta[c].desc}` : "";
    out += bullet(`${pfx}${c}${d}`) + "\n";
  }
  out += footer();
  return out;
}

function formatSearchResults(q, hits, pfx, meta) {
  let out = header(`SEARCH: ${q}`);
  if (!hits.length) {
    out += bullet("No results.") + "\n";
    out += footer();
    return out;
  }
  for (const c of hits.slice(0, 80)) {
    const d = meta[c]?.desc ? ` — ${meta[c].desc}` : "";
    out += bullet(`${pfx}${c}${d}`) + "\n";
  }
  if (hits.length > 80) out += bullet(`...and ${hits.length - 80} more`) + "\n";
  out += footer();
  return out;
}

function formatFavorites(favs, pfx, meta) {
  let out = header("FAVORITES");
  if (!favs.length) {
    out += bullet(`No favorites yet. Add: ${pfx}cs fav add <cmd>`) + "\n";
    out += footer();
    return out;
  }
  for (const c of favs) {
    const d = meta[c]?.desc ? ` — ${meta[c].desc}` : "";
    out += bullet(`${pfx}${c}${d}`) + "\n";
  }
  out += footer();
  return out;
}

function formatExport(cats, pfx) {
  const keys = Object.keys(cats).sort((a, b) => a.localeCompare(b));
  let out = `KORD CHEATSHEET EXPORT\nPrefix: ${pfx}\n\n`;
  for (const k of keys) {
    out += `[${k.toUpperCase()}]\n`;
    for (const c of cats[k]) out += `${pfx}${c}\n`;
    out += "\n";
  }
  return out.trim();
}

/* ---------------- commands ---------------- */
kord(
  { cmd: "cs|cheatsheet", desc: "Show commands cheatsheet", fromMe: wtype, type: "tools", react: "🧠" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      const pfx = SAFE_PREFIX();
      const arg = String(text || "").trim();
      const { cats, meta } = buildIndex();
      const db = readDB();
      const favs = Array.isArray(db.fav) ? db.fav : [];

      if (!arg) {
        return await sendLong(m, formatCategoryList(cats, pfx, favs.length));
      }

      const parts = arg.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "").toLowerCase();

      // favorites
      if (sub === "fav" || sub === "favs") {
        const act = (parts[1] || "").toLowerCase();
        const target = normalizeCmd(parts.slice(2).join(" "));

        if (!act) return await sendLong(m, formatFavorites(favs, pfx, meta));

        if (act === "add") {
          if (!target) return m.reply(`Use: ${pfx}cs fav add <cmd>`);
          if (!meta[target]) return m.reply(`❌ Unknown command: ${target}`);
          const next = uniqSort([...favs, target]);
          db.fav = next;
          writeDB(db);
          return m.reply(`✅ Added favorite: ${pfx}${target}`);
        }

        if (act === "del" || act === "rm" || act === "remove") {
          if (!target) return m.reply(`Use: ${pfx}cs fav del <cmd>`);
          const next = favs.filter((x) => x !== target);
          db.fav = next;
          writeDB(db);
          return m.reply(`✅ Removed favorite: ${pfx}${target}`);
        }

        return m.reply(`Use: ${pfx}cs fav | fav add <cmd> | fav del <cmd>`);
      }

      // find
      if (sub === "find" || sub === "search") {
        const q = parts.slice(1).join(" ").trim().toLowerCase();
        if (!q) return m.reply(`Use: ${pfx}cs find <word>`);
        const allCmds = Object.keys(meta);
        const hits = allCmds.filter((c) => c.toLowerCase().includes(q) || (meta[c]?.desc || "").toLowerCase().includes(q));
        return await sendLong(m, formatSearchResults(q, uniqSort(hits), pfx, meta));
      }

      // export
      if (sub === "export") {
        const out = formatExport(cats, pfx);
        return await sendLong(m, out);
      }

      // category direct
      const want = sub; // first word
      const key = Object.keys(cats).find((k) => k.toLowerCase() === want.toLowerCase());
      if (!key) {
        return m.reply(`❌ Unknown category.\nTry: ${pfx}cs (to see categories) or ${pfx}cs find <word>`);
      }
      return await sendLong(m, formatCommandsInCategory(key, cats[key], pfx, meta));
    } catch (e) {
      return m.reply ? m.reply("❌ cs failed: " + (e?.message || e)) : null;
    }
  }
);