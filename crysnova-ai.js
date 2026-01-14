/* [CRYSNOVA AI ULTRA — PART 1 / 3]
 * File: /home/container/cmds/crysnova.js
 * Deps: axios, openai (canvas optional)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const axios = require("axios");
const OpenAI = require("openai");

const { kord, wtype, config, prefix } = require("../core");

let Canvas = null;
try { Canvas = require("canvas"); } catch {}

const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".crysnova_ultra");
const MEM_FILE = path.join(DATA_DIR, "memory.json");
const PREF_FILE = path.join(DATA_DIR, "prefs.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEM_FILE)) fs.writeFileSync(MEM_FILE, JSON.stringify({ users: {} }, null, 2));
  if (!fs.existsSync(PREF_FILE)) fs.writeFileSync(PREF_FILE, JSON.stringify({ users: {}, chats: {} }, null, 2));
}
function readJSON(file, fallback) {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, obj) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

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
    const list = Array.isArray(sudoRaw) ? sudoRaw : String(sudoRaw).split(",").map(x => x.trim()).filter(Boolean);
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

/* ---------- robust arg parsing (works across KORD variants) ---------- */
function extractAfterCommand(m, cmdNames) {
  const body = getTextFromAny(m, "").trim();
  if (!body) return "";
  const p = SAFE_PREFIX();
  const b = body.startsWith(p) ? body.slice(p.length).trim() : body;
  const low = b.toLowerCase();
  const names = String(cmdNames || "").split("|").map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const n of names) {
    if (low === n) return "";
    if (low.startsWith(n + " ")) return b.slice(n.length).trim();
  }
  return "";
}
function parseSubArgs(m, textArg, cmdNames) {
  let raw = String(textArg || "").trim();
  if (!raw) raw = extractAfterCommand(m, cmdNames);
  const parts = raw.split(/\s+/).filter(Boolean);
  const sub = (parts.shift() || "menu").toLowerCase();
  const rest = parts.join(" ").trim();
  return { sub, rest, parts, raw };
}

/* ---------- sending helpers ---------- */
async function sendText(m, txt, opt = {}) {
  try { if (typeof m.send === "function") return await m.send(txt, opt); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text: String(txt), ...opt }, { quoted: m });
    }
  } catch {}
  try { if (typeof m.reply === "function") return await m.reply(String(txt)); } catch {}
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
  return { text: String(text || ""), mentions: Array.isArray(jids) ? jids : [] };
}

/* ---------- prefs + chat prefs ---------- */
function ukey(m) { return `${getChatId(m)}::${getSenderId(m)}`; }
function ckey(m) { return `${getChatId(m)}`; }

function getUserPrefs(m) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {} });
  return db.users[ukey(m)] || {};
}
function setUserPrefs(m, patch) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {} });
  const k = ukey(m);
  db.users[k] = { ...(db.users[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.users[k];
}
function getChatPrefsById(chatId) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {} });
  return db.chats[String(chatId)] || {};
}
function setChatPrefsById(chatId, patch) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {} });
  const k = String(chatId);
  db.chats[k] = { ...(db.chats[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.chats[k];
}
function getChatPrefs(m) { return getChatPrefsById(ckey(m)); }
function setChatPrefs(m, patch) { return setChatPrefsById(ckey(m), patch); }

/* ---------- memory (per user) ---------- */
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

/* ---------- cooldown (per chat for auto + per user for manual) ---------- */
const COOLDOWN = new Map();
function cdSec() {
  const v = parseInt(getVar("CRYS_COOLDOWN", "3"), 10);
  return Math.max(0, Math.min(30, Number.isFinite(v) ? v : 3));
}
function cooldownHit(key) {
  const s = cdSec();
  if (!s) return 0;
  const now = Date.now();
  const last = COOLDOWN.get(key) || 0;
  if (now - last < s * 1000) return Math.ceil((s * 1000 - (now - last)) / 1000);
  COOLDOWN.set(key, now);
  return 0;
}

/* ---------- tagging detection ---------- */
function getBotJid(m) {
  const a = m?.client?.user?.id || m?.client?.user?.jid || m?.user?.id || "";
  if (a && typeof a === "string") return a.includes("@") ? a : `${a}@s.whatsapp.net`;
  const cfg = getCfgAny();
  const bn = cfg?.BOT_NUMBER || cfg?.BOTNUM || cfg?.NUMBER;
  if (bn) return `${String(bn).replace(/\D/g, "")}@s.whatsapp.net`;
  return "";
}
function getOwnerJidGuess() {
  const cfg = getCfgAny();
  const n = cfg?.OWNER_NUMBER || cfg?.OWNER || cfg?.OWNERNUM || "";
  const digits = String(n || "").replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}
function isTaggedForSession(m) {
  const mentioned = Array.isArray(m?.mentionedJid) ? m.mentionedJid : [];
  if (!mentioned.length) return false;

  const bot = getBotJid(m);
  const owner = getOwnerJidGuess();

  if (bot && mentioned.includes(bot)) return true;
  if (owner && mentioned.includes(owner)) return true;

  const botNum = bot ? bot.split("@")[0] : "";
  const ownerNum = owner ? owner.split("@")[0] : "";
  return mentioned.some(j => {
    const num = String(j).split("@")[0];
    return (botNum && num === botNum) || (ownerNum && num === ownerNum);
  });
}

/* [PART 1 END] */
/* [CRYSNOVA AI ULTRA — PART 2 / 3] */

/* ---------- provider + model (per chat) ---------- */
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();

const DEF_MODEL_OPENAI = (process.env.CRYS_MODEL_OPENAI || "gpt-4o-mini").trim();
const DEF_MODEL_GROQ = (process.env.CRYS_MODEL_GROQ || "llama-3.1-70b-versatile").trim();

function providerState(m) {
  const c = getChatPrefs(m);
  const provider = (c.provider || "openai").toLowerCase(); // openai|groq
  const modelOpenAI = (c.model_openai || DEF_MODEL_OPENAI).trim();
  const modelGroq = (c.model_groq || DEF_MODEL_GROQ).trim();
  return { provider, modelOpenAI, modelGroq };
}
function setProvider(m, p) {
  p = String(p || "").toLowerCase();
  if (!["openai","groq"].includes(p)) return null;
  setChatPrefs(m, { provider: p });
  return p;
}
function setModel(m, provider, model) {
  provider = String(provider || "").toLowerCase();
  model = String(model || "").trim();
  if (!model) return null;
  if (provider === "openai") { setChatPrefs(m, { model_openai: model }); return model; }
  if (provider === "groq") { setChatPrefs(m, { model_groq: model }); return model; }
  return null;
}

function clientFor(provider) {
  if (provider === "groq") {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set.");
    return new OpenAI({ apiKey: GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
  }
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set.");
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

function baseSystem(mode) {
  const hint = {
    chat: "Be friendly, sharp, Nigerian-street-smart but respectful. English + small Pidgin mix when it fits.",
    coach: "Be a practical coach. Give steps, plans, checklists.",
    writer: "Write premium content: captions, bios, scripts, hooks. Give 3 options + best pick.",
    coder: "Debug + explain simply. Give clean code and how to paste into KORD plugins.",
    translate: "Translate cleanly. Keep meaning + tone. If Pidgin requested, do Naija Pidgin well.",
    summarize: "Summarize clearly into bullets, actions, and key points.",
    roast: "Playful banter only. No hate, slurs, threats, or family curses. Keep it witty.",
    auto: "You are replying in WhatsApp. Keep it short, natural, helpful. Avoid long essays."
  }[mode] || "Be helpful.";

  return (
    "You are CRYSNOVA AI, a premium WhatsApp assistant.\n" +
    "Safety rules:\n" +
    "- No hate, slurs, threats, doxxing, scams, or sexual content.\n" +
    "- If user requests harmful actions, refuse and redirect.\n" +
    "Style:\n" + hint
  );
}

/* ---------- premium AI call with fallback (openai <-> groq) ---------- */
async function aiReply(m, userText, mode, callKind /*manual|auto*/) {
  const st = providerState(m);
  const prefer = st.provider;

  const model =
    prefer === "groq" ? st.modelGroq : st.modelOpenAI;

  // cooldown keys
  const chatId = getChatId(m);
  const key = (callKind === "auto") ? `auto::${chatId}` : `manual::${ukey(m)}`;
  const left = cooldownHit(key);
  if (left) throw new Error(`Cooldown: wait ${left}s`);

  // memory (manual keeps rolling context; auto uses short context)
  const history = (callKind === "auto")
    ? []
    : loadMem(m).map(x => ({ role: x.role, content: x.content })).slice(-memCap());

  const messages = [
    { role: "system", content: baseSystem(mode) },
    ...history,
    { role: "user", content: String(userText || "") }
  ];

  async function run(provider) {
    const c = clientFor(provider);
    const useModel = provider === "groq" ? st.modelGroq : st.modelOpenAI;
    const resp = await c.chat.completions.create({
      model: useModel,
      messages,
      temperature: (mode === "roast") ? 0.95 : 0.7,
    });
    const out = resp?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error("AI returned empty response.");
    return { out, provider, model: useModel };
  }

  // Try preferred first, then fallback to the other provider if possible
  try {
    const r = await run(prefer);
    if (callKind !== "auto") {
      pushMem(m, "user", userText);
      pushMem(m, "assistant", r.out);
    }
    return r;
  } catch (e1) {
    const other = (prefer === "groq") ? "openai" : "groq";
    try {
      const r2 = await run(other);
      if (callKind !== "auto") {
        pushMem(m, "user", userText);
        pushMem(m, "assistant", r2.out);
      }
      return r2;
    } catch (e2) {
      // return best error
      const msg = (e1?.message || e1) + " | " + (e2?.message || e2);
      throw new Error(msg);
    }
  }
}

/* ---------- weather + music ---------- */
async function getWeather(city) {
  const apiKey = (process.env.OPENWEATHER_API_KEY || "").trim();
  if (!apiKey) return "Weather not configured: set OPENWEATHER_API_KEY.";
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
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

/* ---------- session + mode ---------- */
function sessionState(m) {
  const c = getChatPrefs(m);
  return {
    on: !!c.session_on,
    mode: (c.session_mode || "tag").toLowerCase(), // tag|all
  };
}
function setSession(m, on) { return setChatPrefs(m, { session_on: !!on }); }
function setMode(m, mode) {
  mode = String(mode || "").toLowerCase();
  if (!["tag","all"].includes(mode)) return null;
  setChatPrefs(m, { session_mode: mode });
  return mode;
}

/* ---------- scheduler targets + config ---------- */
function schedState(m) {
  const c = getChatPrefs(m);
  return {
    enabled: !!c.sched_on,
    on_h: Number.isFinite(+c.sched_on_h) ? +c.sched_on_h : 12,
    on_m: Number.isFinite(+c.sched_on_m) ? +c.sched_on_m : 0,
    off_h: Number.isFinite(+c.sched_off_h) ? +c.sched_off_h : 5,
    off_m: Number.isFinite(+c.sched_off_m) ? +c.sched_off_m : 0,
    targets: Array.isArray(c.sched_targets) ? c.sched_targets : [],
  };
}
function setSched(m, patch) {
  const c = getChatPrefs(m);
  return setChatPrefs(m, { ...c, ...patch });
}
function normalizeJid(s) {
  s = String(s || "").trim();
  if (!s) return "";
  if (s.includes("@g.us") || s.includes("@s.whatsapp.net")) return s;
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return `${digits}@s.whatsapp.net`;
}

/* ---------- canvas menu (optional) ---------- */
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
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(fetchBuffer(res.headers.location));
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
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

  ctx.fillStyle = "#06130d"; ctx.fillRect(0, 0, w, h);
  const bg = (process.env.CRYS_MENU_BG || "").trim();
  if (bg) {
    try {
      const buf = await fetchBuffer(bg);
      const img = await loadImage(buf);
      const scale = Math.max(w / img.width, h / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } catch {}
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
  for (const ln of lines) { ctx.fillText(String(ln), pad, y); y += lineH; }

  ctx.font = `${Math.round(size * 0.028)}px Sans`;
  ctx.fillStyle = theme.neon;
  ctx.fillText("CRYSNOVA AI • ULTRA", pad, h - pad);

  return canvas.toBuffer("image/png");
}

/* [PART 2 END] */
/* [CRYSNOVA AI ULTRA — PART 3 / 3] */

function roastLevelOf(m) {
  const p = getUserPrefs(m);
  return (p.roastlevel || "medium").toLowerCase();
}
function setRoastLevel(m, lvl) {
  lvl = String(lvl || "").toLowerCase();
  if (!["soft","medium","savage"].includes(lvl)) return null;
  setUserPrefs(m, { roastlevel: lvl });
  return lvl;
}
async function doRoast(m, targetLabel) {
  const lvl = roastLevelOf(m);
  const instruction =
    lvl === "soft" ? "Keep it light, friendly, short." :
    lvl === "savage" ? "Be very witty and sharp, but still no hate/slurs/threats/family curses." :
    "Be witty, street-smart, not too harsh.";

  const r = await aiReply(
    m,
    `Generate ONE short Nigerian-style witty roast for: ${targetLabel}. ${instruction}`,
    "roast",
    "manual"
  );
  return r.out.replace(/\s+/g, " ").trim();
}

function menuLines(m) {
  const p = SAFE_PREFIX();
  const ss = sessionState(m);
  const ps = providerState(m);
  const sch = schedState(m);
  return [
    `SESSION: ${ss.on ? "ON" : "OFF"} • MODE: ${ss.mode.toUpperCase()}`,
    `PROVIDER: ${ps.provider.toUpperCase()} • MODEL: ${(ps.provider === "groq" ? ps.modelGroq : ps.modelOpenAI)}`,
    `SCHED: ${sch.enabled ? "ON" : "OFF"} • ON ${String(sch.on_h).padStart(2,"0")}:${String(sch.on_m).padStart(2,"0")} • OFF ${String(sch.off_h).padStart(2,"0")}:${String(sch.off_m).padStart(2,"0")}`,
    "",
    "SESSION",
    `${p}crysnova on`,
    `${p}crysnova off`,
    `${p}crysnova mode tag`,
    `${p}crysnova mode all`,
    `${p}crysnova status`,
    "",
    "PROVIDER",
    `${p}crysnova provider openai`,
    `${p}crysnova provider groq`,
    `${p}crysnova model <name>`,
    `${p}crysnova setup`,
    "",
    "AI",
    `${p}crysnova chat <msg>`,
    `${p}crysnova coach <msg>`,
    `${p}crysnova writer <msg>`,
    `${p}crysnova coder <msg>`,
    `${p}crysnova translate <text>`,
    `${p}crysnova summarize  (reply)`,
    "",
    "FUN",
    `${p}crysnova roast`,
    `${p}crysnova roast @user`,
    `${p}crysnova lastroast (reply)`,
    `${p}crysnova roastlevel soft|medium|savage`,
    "",
    "UTILS",
    `${p}crysnova weather <city>`,
    `${p}crysnova setcity <city>`,
    `${p}crysnova music <query>`,
    "",
    "SCHEDULER (TARGETS)",
    `${p}crysnova sched on`,
    `${p}crysnova sched off`,
    `${p}crysnova sched add <jid|groupid>`,
    `${p}crysnova sched add here`,
    `${p}crysnova sched list`,
    `${p}crysnova sched clear`,
    "",
    "MEMORY",
    `${p}crysnova mem`,
    `${p}crysnova memclear`,
  ];
}

async function sendMenu(m) {
  const img = await makeMenuCard("CRYSNOVA AI", menuLines(m), 900);
  if (img) return sendImage(m, img, "");
  return sendText(m, "CRYSNOVA AI\n\n" + menuLines(m).join("\n"));
}

/* ---------- main command ---------- */
kord(
  {
    cmd: "crysnova|crys",
    desc: "Crysnova AI ULTRA (session + auto reply + scheduler)",
    fromMe: wtype,
    type: "tools",
    react: "💎",
  },
  async (m, textArg) => {
    try {
      const { sub, rest, parts } = parseSubArgs(m, textArg, "crysnova|crys");
      const p = SAFE_PREFIX();

      // menu/help
      if (sub === "menu" || sub === "help") return sendMenu(m);

      // setup
      if (sub === "setup") {
        const ps = providerState(m);
        const okO = OPENAI_API_KEY ? "✅" : "❌";
        const okG = GROQ_API_KEY ? "✅" : "❌";
        const okW = (process.env.OPENWEATHER_API_KEY || "").trim() ? "✅" : "❌";
        const ss = sessionState(m);
        const sch = schedState(m);
        return sendText(
          m,
          `SETUP\n` +
          `Session: ${ss.on ? "ON" : "OFF"} • Mode: ${ss.mode.toUpperCase()}\n` +
          `OpenAI Key: ${okO}\n` +
          `Groq Key: ${okG}\n` +
          `Provider: ${ps.provider}\n` +
          `Model(OpenAI): ${ps.modelOpenAI}\n` +
          `Model(Groq): ${ps.modelGroq}\n` +
          `Weather Key: ${okW}\n` +
          `Memory: ${memCap()} turns\n` +
          `Cooldown: ${cdSec()}s\n` +
          `Theme: ${(process.env.CRYS_THEME || "neon")}\n` +
          `Scheduler: ${sch.enabled ? "ON" : "OFF"} • Targets: ${sch.targets.length}`
        );
      }

      // session controls
      if (sub === "on") {
        if (!isAllowed(m)) return;
        setSession(m, true);
        return sendText(m, `Session ON. Mode: ${sessionState(m).mode.toUpperCase()}`);
      }
      if (sub === "off") {
        if (!isAllowed(m)) return;
        setSession(m, false);
        return sendText(m, "Session OFF.");
      }
      if (sub === "mode") {
        if (!isAllowed(m)) return;
        const md = setMode(m, rest);
        if (!md) return sendText(m, `Use: ${p}crysnova mode tag  OR  ${p}crysnova mode all`);
        return sendText(m, `Mode set: ${md.toUpperCase()}`);
      }
      if (sub === "status") {
        const ss = sessionState(m);
        const ps = providerState(m);
        const sch = schedState(m);
        return sendText(
          m,
          `Session: ${ss.on ? "ON" : "OFF"}\n` +
          `Mode: ${ss.mode.toUpperCase()}\n` +
          `Provider: ${ps.provider.toUpperCase()}\n` +
          `Model: ${(ps.provider === "groq" ? ps.modelGroq : ps.modelOpenAI)}\n` +
          `Scheduler: ${sch.enabled ? "ON" : "OFF"} • Targets: ${sch.targets.length}`
        );
      }

      // provider switch
      if (sub === "provider") {
        if (!isAllowed(m)) return;
        const pv = setProvider(m, rest);
        if (!pv) return sendText(m, `Use: ${p}crysnova provider openai|groq`);
        return sendText(m, `Provider set: ${pv}`);
      }
      if (sub === "model") {
        if (!isAllowed(m)) return;
        const ps = providerState(m);
        const md = setModel(m, ps.provider, rest);
        if (!md) return sendText(m, `Use: ${p}crysnova model <modelName>`);
        return sendText(m, `Model set for ${ps.provider.toUpperCase()}: ${md}`);
      }

      // scheduler controls
      if (sub === "sched") {
        if (!isAllowed(m)) return;
        const action = (parts[0] || "").toLowerCase();
        const sch = schedState(m);

        if (action === "on") {
          setSched(m, { sched_on: true });
          return sendText(m, "Scheduler ON.");
        }
        if (action === "off") {
          setSched(m, { sched_on: false });
          return sendText(m, "Scheduler OFF.");
        }
        if (action === "add") {
          const arg = parts[1] || "";
          let jid = "";
          if (String(arg).toLowerCase() === "here") jid = getChatId(m);
          else jid = normalizeJid(arg);

          if (!jid) return sendText(m, `Use: ${p}crysnova sched add here  OR  ${p}crysnova sched add <jid|groupid>`);
          const next = Array.from(new Set([...(sch.targets || []), jid]));
          setSched(m, { sched_targets: next });
          return sendText(m, `Scheduler target added: ${jid}\nTotal targets: ${next.length}`);
        }
        if (action === "list") {
          const list = (sch.targets || []);
          if (!list.length) return sendText(m, "Scheduler target list is empty.");
          return sendText(m, "Scheduler targets:\n" + list.map((x,i)=>`${i+1}. ${x}`).join("\n"));
        }
        if (action === "clear") {
          setSched(m, { sched_targets: [] });
          return sendText(m, "Scheduler targets cleared.");
        }

        return sendText(
          m,
          `Scheduler commands:\n` +
          `${p}crysnova sched on|off\n` +
          `${p}crysnova sched add here\n` +
          `${p}crysnova sched add <jid|groupid>\n` +
          `${p}crysnova sched list\n` +
          `${p}crysnova sched clear`
        );
      }

      // memory
      if (sub === "mem") {
        const hist = loadMem(m);
        return sendText(m, `Memory saved: ${hist.length}/${memCap()}`);
      }
      if (sub === "memclear") {
        clearMem(m);
        return sendText(m, "Memory cleared for this chat/user.");
      }

      // roast level
      if (sub === "roastlevel") {
        const lvl = setRoastLevel(m, rest);
        if (!lvl) return sendText(m, "Use: crysnova roastlevel soft|medium|savage");
        return sendText(m, `Roast level set: ${lvl}`);
      }

      // setcity/weather
      if (sub === "setcity") {
        if (!rest) return sendText(m, "Use: crysnova setcity <city>");
        setUserPrefs(m, { city: rest });
        return sendText(m, `Default city set: ${rest}`);
      }
      if (sub === "weather") {
        const up = getUserPrefs(m);
        const city = rest || up.city;
        if (!city) return sendText(m, "Use: crysnova weather <city> (or set default: crysnova setcity <city>)");
        const rep = await getWeather(city);
        return sendText(m, rep);
      }

      // music
      if (sub === "music") {
        if (!rest) return sendText(m, "Use: crysnova music <song or artist>");
        const result = await searchMusic(rest);
        await sendText(m, result.text);
        if (result.preview && m?.client?.sendMessage) {
          try {
            return await m.client.sendMessage(getChatId(m), { audio: { url: result.preview }, mimetype: "audio/mp4" }, { quoted: m });
          } catch {}
        }
        return null;
      }

      // summarize (reply)
      if (sub === "summarize") {
        const quoted = m?.quoted;
        const qtxt = quoted?.text || quoted?.msg || "";
        if (!qtxt) return sendText(m, "Reply to a message then use: crysnova summarize");
        const r = await aiReply(m, `Summarize this:\n\n${qtxt}`, "summarize", "manual");
        return sendText(m, r.out);
      }

      // roast / lastroast
      if (sub === "roast") {
        if (m?.mentionedJid?.length) {
          const user = m.mentionedJid[0];
          const roast = await doRoast(m, `@${user.split("@")[0]}`);
          return sendText(m, withMentions(roast, [user]));
        }
        const roast = await doRoast(m, "me");
        return sendText(m, roast);
      }
      if (sub === "lastroast") {
        const q = m?.quoted;
        if (!q) return sendText(m, "Reply to someone’s message, then use: crysnova lastroast");
        const user = q.sender;
        const roast = await doRoast(m, `@${String(user || "").split("@")[0] || "user"}`);
        return sendText(m, withMentions(roast, user ? [user] : []));
      }

      // AI modes
      const modes = new Set(["chat","coach","writer","coder","translate"]);
      if (modes.has(sub)) {
        if (!rest) return sendText(m, `Use: ${p}crysnova ${sub} <message>`);
        const r = await aiReply(m, rest, sub, "manual");
        return sendText(m, r.out);
      }

      return sendText(m, `Unknown. Try: ${p}crysnova menu`);
    } catch (e) {
      return sendText(m, "❌ CRYSNOVA error: " + (e?.message || e));
    }
  }
);

/* ---------- AUTO-REPLY LISTENER ---------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!m) return;
    if (m?.fromMe) return;

    const ss = sessionState(m);
    if (!ss.on) return;

    // tag mode requires mention (bot or owner)
    if (ss.mode === "tag" && !isTaggedForSession(m)) return;

    const txt = getTextFromAny(m, textArg).trim();
    if (!txt) return;

    // ignore commands to prevent "check menu" loops
    const p = SAFE_PREFIX();
    if (txt.startsWith(p)) return;

    // ignore extremely long spam
    if (txt.length > 3000) return;

    const name = m?.pushName ? String(m.pushName).trim() : "user";
    const prompt =
      `Reply as CRYSNOVA AI.\n` +
      `Sender: ${name}\n` +
      `Message: ${txt}\n\n` +
      `Reply short, helpful, natural.`;

    const r = await aiReply(m, prompt, "auto", "auto");
    return sendText(m, r.out);
  } catch {
    // silent (premium: no spam)
    return;
  }
});

/* ---------- SCHEDULER LOOP (Africa/Lagos) ----------
   Sends ON at 12:00, OFF at 05:00 to saved target chats.
   NOTE: "auto-scheduler takes send and others off" meaning:
   - Scheduler only toggles Session ON/OFF
   - It does NOT spam replies; it only changes state.
---------------------------------------------------- */
let LAST_TICK = { on: "", off: "" };

function lagosNowParts() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = fmt.formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  const y = parts.year, mo = parts.month, da = parts.day;
  const hh = parseInt(parts.hour, 10);
  const mm = parseInt(parts.minute, 10);
  return { y, mo, da, hh, mm, keyDay: `${y}-${mo}-${da}` };
}

async function schedSendToggle(client, jid, on) {
  try {
    setChatPrefsById(jid, { session_on: !!on }); // toggle the session for that chat
    const msg = on ? "Session ON. Mode: ALL" : "Session OFF.";
    if (client?.sendMessage) {
      await client.sendMessage(jid, { text: msg });
    }
  } catch {}
}

setInterval(async () => {
  try {
    // We need a client ref — grab from last known? We can pull from global by caching from messages.
    // If no cached client yet, scheduler will begin once bot receives any message.
    if (!global.__CRYS_CLIENT) return;

    const now = lagosNowParts();
    const dayKey = now.keyDay;

    // iterate chats stored in prefs to find scheduler-enabled ones + their targets
    const db = readJSON(PREF_FILE, { users: {}, chats: {} });
    const chats = db.chats || {};
    for (const chatId of Object.keys(chats)) {
      const c = chats[chatId] || {};
      if (!c.sched_on) continue;
      const targets = Array.isArray(c.sched_targets) ? c.sched_targets : [];
      if (!targets.length) continue;

      const onH = Number.isFinite(+c.sched_on_h) ? +c.sched_on_h : 12;
      const onM = Number.isFinite(+c.sched_on_m) ? +c.sched_on_m : 0;
      const offH = Number.isFinite(+c.sched_off_h) ? +c.sched_off_h : 5;
      const offM = Number.isFinite(+c.sched_off_m) ? +c.sched_off_m : 0;

      // ON tick (once per day)
      if (now.hh === onH && now.mm === onM) {
        const tickKey = `${dayKey}::on::${chatId}`;
        if (LAST_TICK.on !== tickKey) {
          LAST_TICK.on = tickKey;
          for (const t of targets) await schedSendToggle(global.__CRYS_CLIENT, t, true);
        }
      }

      // OFF tick (once per day)
      if (now.hh === offH && now.mm === offM) {
        const tickKey = `${dayKey}::off::${chatId}`;
        if (LAST_TICK.off !== tickKey) {
          LAST_TICK.off = tickKey;
          for (const t of targets) await schedSendToggle(global.__CRYS_CLIENT, t, false);
        }
      }
    }
  } catch {}
}, 20 * 1000);

/* cache client for scheduler */
kord({ on: "all" }, async (m) => {
  try {
    if (m?.client) global.__CRYS_CLIENT = m.client;
  } catch {}
});

module.exports = {};

/* [PART 3 END] */