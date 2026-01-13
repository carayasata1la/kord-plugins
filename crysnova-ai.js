/* [CRYSNOVA PART 1 / 3] */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const axios = require("axios");
const OpenAI = require("openai");

const { kord, wtype, config, prefix } = require("../core");

let Canvas = null;
try { Canvas = require("canvas"); } catch {}

/* ----------------- SAFE CONFIG ----------------- */
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
function getVar(name, fallback = "") {
  const env = process.env?.[name];
  if (env !== undefined && env !== null) {
    const s = String(env).trim();
    if (s) return s;
  }
  const cfg = getCfgAny();
  const v = cfg?.[name];
  if (v !== undefined && v !== null) {
    const s = String(v).trim();
    if (s) return s;
  }
  return fallback;
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
    const list = Array.isArray(sudoRaw) ? sudoRaw : String(sudoRaw).split(",").map(x=>x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
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

/* ----------------- SEND HELPERS ----------------- */
async function sendText(m, txt, opt = {}) {
  try { if (typeof m.send === "function") return await m.send(txt, opt); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text: txt, ...opt }, { quoted: m });
    }
  } catch {}
  try { if (typeof m.reply === "function") return await m.reply(txt); } catch {}
  return null;
}
async function sendImage(m, buf, caption = "", opt = {}) {
  try { if (typeof m.replyimg === "function") return await m.replyimg(buf, caption); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { image: buf, caption, ...opt }, { quoted: m });
    }
  } catch {}
  return sendText(m, caption || "✅", opt);
}
function withMentions(text, jids) {
  return { text, mentions: Array.isArray(jids) ? jids : [] };
}

/* ----------------- STORAGE ----------------- */
const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".crysnova");
const MEM_FILE = path.join(DATA_DIR, "memory.json");
const PREF_FILE = path.join(DATA_DIR, "prefs.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEM_FILE)) fs.writeFileSync(MEM_FILE, JSON.stringify({ users: {} }, null, 2));
  if (!fs.existsSync(PREF_FILE)) fs.writeFileSync(PREF_FILE, JSON.stringify({ users: {} }, null, 2));
}
function readJSON(file, fallback) {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, obj) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
function ukey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}
function getPrefs(m) {
  const db = readJSON(PREF_FILE, { users: {} });
  return db.users[ukey(m)] || {};
}
function setPrefs(m, patch) {
  const db = readJSON(PREF_FILE, { users: {} });
  const k = ukey(m);
  db.users[k] = { ...(db.users[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.users[k];
}

/* ----------------- MEMORY ----------------- */
function memCap() {
  const v = parseInt(getVar("CRYS_MEM", "24"), 10);
  return Math.max(8, Math.min(80, Number.isFinite(v) ? v : 24));
}
function loadMem(m) {
  const db = readJSON(MEM_FILE, { users: {} });
  return db.users[ukey(m)] || [];
}
function saveMem(m, arr) {
  const db = readJSON(MEM_FILE, { users: {} });
  db.users[ukey(m)] = arr;
  writeJSON(MEM_FILE, db);
}
function pushMem(m, role, content) {
  const cap = memCap();
  const arr = loadMem(m);
  arr.push({ role, content: String(content || "").slice(0, 4000), ts: Date.now() });
  while (arr.length > cap) arr.shift();
  saveMem(m, arr);
}
function clearMem(m) {
  const db = readJSON(MEM_FILE, { users: {} });
  delete db.users[ukey(m)];
  writeJSON(MEM_FILE, db);
}

/* ----------------- COOLDOWN ----------------- */
const COOLDOWN = new Map();
function cdSec() {
  const v = parseInt(getVar("CRYS_COOLDOWN", "5"), 10);
  return Math.max(0, Math.min(30, Number.isFinite(v) ? v : 5));
}
function checkCooldown(m) {
  const s = cdSec();
  if (!s) return null;
  const k = ukey(m);
  const now = Date.now();
  const last = COOLDOWN.get(k) || 0;
  if (now - last < s * 1000) {
    const left = Math.ceil((s * 1000 - (now - last)) / 1000);
    return left;
  }
  COOLDOWN.set(k, now);
  return null;
}

/* ----------------- OPENAI ----------------- */
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const MODEL = (process.env.CRYS_MODEL || "gpt-4o-mini").trim();
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/* ----------------- CANVAS MENU ----------------- */
const THEMES = {
  neon:   { neon:"#27ff9a", dim:"#eafff6", border:"#1ccf7b", panel:"rgba(6,24,15,0.72)" },
  ice:    { neon:"#7df3ff", dim:"#e8fbff", border:"#3ad7ff", panel:"rgba(6,16,24,0.72)" },
  purple: { neon:"#c77dff", dim:"#f4eaff", border:"#8a2be2", panel:"rgba(16,6,24,0.74)" },
  gold:   { neon:"#ffd166", dim:"#fff7df", border:"#ffb703", panel:"rgba(24,18,6,0.74)" },
};
function themeNow() {
  const t = (process.env.CRYS_THEME || "neon").trim().toLowerCase();
  return THEMES[t] || THEMES.neon;
}
function bgUrl() {
  return (process.env.CRYS_MENU_BG || "").trim();
}
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
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
    }).on("error", reject);
  });
}
async function makeMenuCard(title, lines, size = 900) {
  if (!Canvas) return null;
  const { createCanvas, loadImage } = Canvas;
  const theme = themeNow();

  const w = size;
  const pad = Math.round(size * 0.06);
  const lineH = Math.round(size * 0.041);
  const titleH = Math.round(size * 0.085);

  const h = pad + titleH + 18 + lines.length * lineH + pad + 60;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  const bg = bgUrl();
  if (bg) {
    try {
      const buf = await fetchBuffer(bg);
      const img = await loadImage(buf);
      const scale = Math.max(w / img.width, h / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } catch {
      ctx.fillStyle = "#06130d"; ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = "#06130d"; ctx.fillRect(0, 0, w, h);
  }

  ctx.fillStyle = "rgba(0,0,0,0.48)"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = theme.border; ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(24, 24, w - 48, h - 48);

  ctx.font = `bold ${Math.round(size * 0.055)}px Sans`;
  ctx.fillStyle = theme.neon;
  ctx.fillText(title, pad, pad + Math.round(size * 0.06));

  ctx.strokeStyle = theme.border; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, pad + titleH);
  ctx.lineTo(w - pad, pad + titleH);
  ctx.stroke();

  ctx.font = `${Math.round(size * 0.033)}px Sans`;
  ctx.fillStyle = theme.dim;

  let y = pad + titleH + Math.round(size * 0.055);
  for (const ln of lines) {
    ctx.fillText(String(ln), pad, y);
    y += lineH;
  }

  ctx.font = `${Math.round(size * 0.028)}px Sans`;
  ctx.fillStyle = theme.neon;
  ctx.fillText("CRYSNOVA AI • PREMIUM", pad, h - pad);

  return canvas.toBuffer("image/png");
}
/* [CRYSNOVA PART 2 / 3] */

/* ----------------- AI SYSTEM ----------------- */
function baseSystem(mode) {
  const modeHint = {
    chat: "Be friendly, sharp, Nigerian-street-smart but respectful. English + small Pidgin mix when it fits.",
    coach: "Be a practical coach. Give steps, plans, checklists.",
    writer: "Write premium content: captions, bios, scripts, hooks. Give 3 options + best pick.",
    coder: "Debug + explain simply. Give clean code and how to paste it into KORD plugins.",
    translate: "Translate cleanly. Keep meaning + tone. If Pidgin requested, do Naija Pidgin well.",
    summarize: "Summarize clearly into bullets, actions, and key points.",
    roast: "Generate playful banter only. No slurs, no hate, no threats, no family curses. Keep it witty."
  }[mode] || "Be helpful.";

  return (
    "You are CRYSNOVA AI, a premium WhatsApp assistant.\n" +
    "Rules:\n" +
    "- Keep responses concise but premium.\n" +
    "- Never output hate, slurs, threats, or doxxing.\n" +
    "- If asked for harmful content, refuse and redirect.\n" +
    "Mode:\n" + modeHint
  );
}

async function aiReply(m, userText, mode = "chat") {
  if (!openai) throw new Error("OPENAI_API_KEY not set.");

  const left = checkCooldown(m);
  if (left) throw new Error(`Cooldown: wait ${left}s`);

  const history = loadMem(m).map(x => ({ role: x.role, content: x.content }));
  const messages = [
    { role: "system", content: baseSystem(mode) },
    ...history.slice(-memCap()),
    { role: "user", content: userText }
  ];

  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages,
    temperature: mode === "roast" ? 0.95 : 0.7,
  });

  const out = resp?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("AI returned empty response.");

  pushMem(m, "user", userText);
  pushMem(m, "assistant", out);
  return out;
}

/* ----------------- WEATHER + MUSIC ----------------- */
async function getWeather(city) {
  const apiKey = (process.env.OPENWEATHER_API_KEY || "").trim();
  if (!apiKey) return "Weather not configured: set OPENWEATHER_API_KEY.";
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=metric`;
  const res = await axios.get(url, { timeout: 20000 });
  const w = res.data;
  return (
    `Weather: ${w.name}\n` +
    `Condition: ${w.weather?.[0]?.description || "-"}\n` +
    `Temp: ${w.main?.temp ?? "-"}°C (feels ${w.main?.feels_like ?? "-"}°C)\n` +
    `Humidity: ${w.main?.humidity ?? "-"}%\n` +
    `Wind: ${w.wind?.speed ?? "-"} m/s`
  );
}

async function searchMusic(query) {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
  const res = await axios.get(url, { timeout: 20000 });
  const data = res.data?.data || [];
  if (!data.length) return { text: "No music found.", preview: null };
  const s = data[0];
  return {
    text:
      `Now Playing (Preview)\n` +
      `${s.title}\n` +
      `${s.artist?.name || ""} • ${s.album?.title || ""}\n` +
      `Preview: 30s`,
    preview: s.preview || null
  };
}

/* ----------------- MENU ----------------- */
function menuLines() {
  const p = SAFE_PREFIX();
  return [
    `${p}crysnova menu`,
    `${p}crysnova setup`,
    "",
    "AI MODES",
    `${p}crysnova chat <msg>`,
    `${p}crysnova coach <msg>`,
    `${p}crysnova writer <msg>`,
    `${p}crysnova coder <msg>`,
    `${p}crysnova translate <text>`,
    `${p}crysnova summarize   (reply)`,
    "",
    "FUN",
    `${p}crysnova roast`,
    `${p}crysnova roast @user`,
    `${p}crysnova lastroast   (reply)`,
    `${p}crysnova roastlevel <soft|medium|savage>`,
    "",
    "UTILS",
    `${p}crysnova weather <city>`,
    `${p}crysnova setcity <city>`,
    `${p}crysnova music <query>`,
    "",
    "AUTO-REPLY (tags / reply-to-bot)",
    `${p}crysnova on`,
    `${p}crysnova off`,
    `${p}crysnova status`,
    `${p}crysnova automode on`,
    `${p}crysnova automode off`,
    `${p}crysnova mode <chat|coach|writer|coder|translate>`,
    "",
    "MEMORY",
    `${p}crysnova mem`,
    `${p}crysnova memclear`
  ];
}
async function sendMenu(m) {
  const img = await makeMenuCard("CRYSNOVA AI", menuLines(), 900);
  if (img) return sendImage(m, img, "");
  return sendText(m, "CRYSNOVA AI\n\n" + menuLines().join("\n"));
}

/* ----------------- ROAST ----------------- */
function roastLevelOf(m) {
  const p = getPrefs(m);
  return (p.roastlevel || "medium").toLowerCase();
}
function setRoastLevel(m, lvl) {
  lvl = String(lvl || "").toLowerCase();
  if (!["soft","medium","savage"].includes(lvl)) return null;
  setPrefs(m, { roastlevel: lvl });
  return lvl;
}
async function doRoast(m, targetLabel) {
  const lvl = roastLevelOf(m);
  const instruction =
    lvl === "soft" ? "Keep it light, friendly, short." :
    lvl === "savage" ? "Be very witty and sharp, but still no slurs/threats/family curses." :
    "Be witty, street-smart, not too harsh.";

  const text = await aiReply(
    m,
    `Generate ONE short Nigerian-style witty roast for: ${targetLabel}. ${instruction}`,
    "roast"
  );
  return text.replace(/\s+/g, " ").trim();
}
/* [CRYSNOVA PART 3 / 3] */

/* ----------------- AUTO SESSION (ON/OFF + SMART MODE) ----------------- */
function envStr(name, fallback = "") {
  const v = process.env?.[name];
  return v !== undefined && v !== null ? String(v).trim() : fallback;
}
function ownerJidHard() {
  return envStr("CRYS_OWNER_JID", "");
}
function botJidGuess(m) {
  try {
    const id = m?.client?.user?.id || m?.client?.user?.jid || m?.user || "";
    return String(id || "").trim();
  } catch {
    return "";
  }
}
function isEnabled(m) {
  const p = getPrefs(m);
  return !!p.enabled;
}
function setEnabled(m, v) {
  setPrefs(m, { enabled: !!v });
  return !!v;
}
function isAutoMode(m) {
  const p = getPrefs(m);
  if (typeof p.automode === "boolean") return p.automode;
  return true;
}
function setAutoMode(m, v) {
  setPrefs(m, { automode: !!v });
  return !!v;
}
function getFixedMode(m) {
  const p = getPrefs(m);
  const v = (p.fixedmode || "chat").toLowerCase();
  return ["chat","coach","writer","coder","translate"].includes(v) ? v : "chat";
}
function setFixedMode(m, v) {
  v = String(v || "").toLowerCase();
  if (!["chat","coach","writer","coder","translate"].includes(v)) return null;
  setPrefs(m, { fixedmode: v });
  return v;
}

const AUTO_CD = new Map();
function autoCooldownSec() {
  const n = parseInt(envStr("CRYS_AUTOREPLY_COOLDOWN", "2"), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(10, n));
}
function hitAutoCooldown(m) {
  const s = autoCooldownSec();
  if (!s) return false;
  const k = `${getChatId(m)}::AUTO`;
  const now = Date.now();
  const last = AUTO_CD.get(k) || 0;
  if (now - last < s * 1000) return true;
  AUTO_CD.set(k, now);
  return false;
}
function isCommandText(t) {
  const p = SAFE_PREFIX();
  const s = String(t || "").trim();
  return !!(p && s.startsWith(p));
}
function shouldAutoReply(m) {
  if (!isEnabled(m)) return false;
  if (m?.fromMe) return false;
  if (m?.isBot) return false;
  if (m?.isBaileys) return false;

  const raw =
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text ||
    m?.body ||
    "";
  if (isCommandText(raw)) return false;

  const ownerJid = ownerJidHard();
  const botJid = botJidGuess(m);

  if (ownerJid && Array.isArray(m?.mentionedJid) && m.mentionedJid.includes(ownerJid)) return true;
  if (botJid && Array.isArray(m?.mentionedJid) && m.mentionedJid.includes(botJid)) return true;
  if (m?.quoted && (m.quoted?.fromMe || m.quoted?.isBot)) return true;

  return false;
}
function smartModeFromText(txt) {
  const t = String(txt || "").toLowerCase().trim();
  if (!t) return "chat";

  if (t.startsWith("translate") || t.includes(" translate ") || t.includes(" into ") || t.includes(" to pidgin") || t.includes(" to french") || t.includes(" to english")) {
    return "translate";
  }
  if (t.startsWith("summarize") || t.includes(" summarize ") || t.includes(" summary ") || t.includes(" key points") || t.includes(" tl;dr")) {
    return "summarize";
  }
  if (t.includes("error") || t.includes("bug") || t.includes("fix") || t.includes("syntax") || t.includes("stack") || t.includes("node") || t.includes("npm") || t.includes("plugin") || t.includes("kord") || t.includes("js code") || t.includes("javascript")) {
    return "coder";
  }
  if (t.includes("caption") || t.includes("bio") || t.includes("script") || t.includes("hook") || t.includes("copywriting") || t.includes("write") || t.includes("rewrite") || t.includes("content")) {
    return "writer";
  }
  if (t.includes("plan") || t.includes("steps") || t.includes("strategy") || t.includes("how do i") || t.includes("what should i") || t.includes("guide") || t.includes("checklist")) {
    return "coach";
  }
  return "chat";
}

/* ----------------- MAIN COMMAND ROUTER ----------------- */
kord(
  {
    cmd: "crysnova|crys",
    desc: "Crysnova AI (premium assistant + auto tag reply)",
    fromMe: wtype,
    type: "tools",
    react: "💎",
  },
  async (m, text) => {
    try {
      const raw = getTextFromAny(m, text).trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "menu").toLowerCase();
      const rest = args.slice(1).join(" ").trim();
      const p = SAFE_PREFIX();

      if (sub === "menu" || sub === "help") return sendMenu(m);

      if (sub === "setup") {
        const okAI = OPENAI_API_KEY ? "✅" : "❌";
        const okW = (process.env.OPENWEATHER_API_KEY || "").trim() ? "✅" : "❌";
        const okOwner = ownerJidHard() ? "✅" : "❌";
        return sendText(
          m,
          `CRYSNOVA SETUP\nAI Key: ${okAI}\nWeather Key: ${okW}\nCRYS_OWNER_JID: ${okOwner}\nModel: ${MODEL}\nMemory: ${memCap()} (rolling)\nCooldown: ${cdSec()}s\nAuto Cooldown: ${autoCooldownSec()}s\nTheme: ${(process.env.CRYS_THEME || "neon")}`
        );
      }

      if (sub === "on") {
        setEnabled(m, true);
        return sendText(m, "CRYSNOVA Auto-Reply: ON\nTurn off: crysnova off");
      }
      if (sub === "off") {
        setEnabled(m, false);
        return sendText(m, "CRYSNOVA Auto-Reply: OFF");
      }
      if (sub === "status") {
        return sendText(
          m,
          `CRYSNOVA Auto-Reply Status\nState: ${isEnabled(m) ? "ON" : "OFF"}\nAutoMode: ${isAutoMode(m) ? "ON" : "OFF"}\nFixed Mode: ${getFixedMode(m)}`
        );
      }
      if (sub === "automode") {
        const v = rest.toLowerCase();
        if (v !== "on" && v !== "off") return sendText(m, `Use: ${p}crysnova automode on|off`);
        setAutoMode(m, v === "on");
        return sendText(m, `AutoMode: ${v.toUpperCase()}`);
      }
      if (sub === "mode") {
        const v = setFixedMode(m, rest);
        if (!v) return sendText(m, `Use: ${p}crysnova mode chat|coach|writer|coder|translate`);
        return sendText(m, `Fixed Mode set: ${v}`);
      }

      if (sub === "mem") return sendText(m, `Memory turns saved: ${loadMem(m).length}/${memCap()}`);
      if (sub === "memclear") { clearMem(m); return sendText(m, "Memory cleared for this chat/user."); }

      if (sub === "roastlevel") {
        const lvl = setRoastLevel(m, rest);
        if (!lvl) return sendText(m, `Use: ${p}crysnova roastlevel soft|medium|savage`);
        return sendText(m, `Roast level set: ${lvl}`);
      }

      if (sub === "setcity") {
        if (!rest) return sendText(m, `Use: ${p}crysnova setcity <city>`);
        setPrefs(m, { city: rest });
        return sendText(m, `Default city set: ${rest}`);
      }
      if (sub === "weather") {
        const prefs = getPrefs(m);
        const city = rest || prefs.city;
        if (!city) return sendText(m, `Use: ${p}crysnova weather <city>`);
        return sendText(m, await getWeather(city));
      }

      if (sub === "music") {
        if (!rest) return sendText(m, `Use: ${p}crysnova music <song or artist>`);
        const result = await searchMusic(rest);
        await sendText(m, result.text);
        if (result.preview && m?.client?.sendMessage) {
          try {
            return await m.client.sendMessage(getChatId(m), { audio: { url: result.preview }, mimetype: "audio/mp4" }, { quoted: m });
          } catch {}
        }
        return null;
      }

      if (sub === "summarize") {
        const quoted = m?.quoted;
        const qtxt = quoted?.text || quoted?.msg || "";
        if (!qtxt) return sendText(m, `Reply to a message then use: ${p}crysnova summarize`);
        const out = await aiReply(m, `Summarize this:\n\n${qtxt}`, "summarize");
        return sendText(m, out);
      }

      if (sub === "roast") {
        if (m?.mentionedJid?.length) {
          const user = m.mentionedJid[0];
          const roast = await doRoast(m, `@${user.split("@")[0]}`);
          return sendText(m, withMentions(`${roast}`, [user]));
        }
        return sendText(m, await doRoast(m, "me"));
      }
      if (sub === "lastroast") {
        const q = m?.quoted;
        if (!q) return sendText(m, `Reply then use: ${p}crysnova lastroast`);
        const user = q.sender;
        const roast = await doRoast(m, `@${String(user || "").split("@")[0] || "user"}`);
        return sendText(m, withMentions(`${roast}`, user ? [user] : []));
      }

      const modeMap = new Set(["chat","coach","writer","coder","translate"]);
      if (modeMap.has(sub)) {
        if (!rest) return sendText(m, `Use: ${p}crysnova ${sub} <message>`);
        return sendText(m, await aiReply(m, rest, sub));
      }

      return sendText(m, `Unknown. Try: ${p}crysnova menu`);
    } catch (e) {
      return sendText(m, "❌ CRYSNOVA error: " + (e?.message || e));
    }
  }
);

/* ----------------- AUTO-REPLY LISTENER ----------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!shouldAutoReply(m)) return;
    if (hitAutoCooldown(m)) return;
    if (!openai) return;

    const msg = getTextFromAny(m, textArg).trim();
    if (!msg) return;

    let mode = "chat";
    if (isAutoMode(m)) {
      mode = smartModeFromText(msg);
      if (mode === "summarize" && !m?.quoted) mode = "chat";
    } else {
      mode = getFixedMode(m);
    }

    if (mode === "summarize" && m?.quoted) {
      const qtxt = m.quoted?.text || m.quoted?.msg || "";
      if (qtxt) {
        const out = await aiReply(m, `Summarize this:\n\n${qtxt}`, "summarize");
        return await sendText(m, out);
      }
      mode = "chat";
    }

    const out = await aiReply(m, msg, mode);
    return await sendText(m, out);
  } catch {
    return;
  }
});

module.exports = {};