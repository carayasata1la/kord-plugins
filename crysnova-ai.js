const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const axios = require("axios");
const OpenAI = require("openai");
const cron = require("node-cron");

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
  if (!fs.existsSync(PREF_FILE)) fs.writeFileSync(PREF_FILE, JSON.stringify({ users: {}, chats: {}, targets: {}, sched: {} }, null, 2));
}
function readJSON(file, fallback) {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, obj) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
function ukey(m) { return `${getChatId(m)}::${getSenderId(m)}`; }
function chatKey(m) { return `${getChatId(m)}`; }

function getPrefs(m) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  return db.users[ukey(m)] || {};
}
function setPrefs(m, patch) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  const k = ukey(m);
  db.users[k] = { ...(db.users[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.users[k];
}
function getChatPrefs(m) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  return db.chats[chatKey(m)] || {};
}
function setChatPrefs(m, patch) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  const k = chatKey(m);
  db.chats[k] = { ...(db.chats[k] || {}), ...patch };
  writeJSON(PREF_FILE, db);
  return db.chats[k];
}

/* ----------------- TARGETS (broadcast list) ----------------- */
function getTargets() {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  return db.targets || {};
}
function setTargets(obj) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  db.targets = obj || {};
  writeJSON(PREF_FILE, db);
}
function addTarget(chatId) {
  const t = getTargets();
  t[chatId] = { addedAt: Date.now() };
  setTargets(t);
}
function delTarget(chatId) {
  const t = getTargets();
  delete t[chatId];
  setTargets(t);
}
function listTargets() {
  const t = getTargets();
  return Object.keys(t);
}
function clearTargets() {
  setTargets({});
}

/* ----------------- SCHEDULER PREFS ----------------- */
function getSched() {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  const s = db.sched || {};
  return {
    enabled: !!s.enabled,
    onTime: s.onTime || "12:00",
    offTime: s.offTime || "05:00",
    msgOn: s.msgOn || "CRYSNOVA session enabled.",
    msgOff: s.msgOff || "CRYSNOVA session disabled.",
  };
}
function setSched(patch) {
  const db = readJSON(PREF_FILE, { users: {}, chats: {}, targets: {}, sched: {} });
  db.sched = { ...(db.sched || {}), ...(patch || {}) };
  writeJSON(PREF_FILE, db);
  return getSched();
}

/* ----------------- MEMORY (rolling) ----------------- */
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
  const v = parseInt(getVar("CRYS_COOLDOWN", "6"), 10);
  return Math.max(0, Math.min(30, Number.isFinite(v) ? v : 6));
}
function checkCooldownKey(key) {
  const s = cdSec();
  if (!s) return null;
  const now = Date.now();
  const last = COOLDOWN.get(key) || 0;
  if (now - last < s * 1000) return Math.ceil((s * 1000 - (now - last)) / 1000);
  COOLDOWN.set(key, now);
  return null;
}

/* ----------------- OPENAI (primary + fallback) ----------------- */
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_API_KEY2 = (process.env.OPENAI_API_KEY2 || "").trim();

const MODEL = (process.env.CRYS_MODEL || "gpt-4o-mini").trim();
const FALLBACK_MODEL = (process.env.CRYS_FALLBACK_MODEL || "gpt-4.1").trim();

const openai1 = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const openai2 = OPENAI_API_KEY2 ? new OpenAI({ apiKey: OPENAI_API_KEY2 }) : null;

function shouldFallback(errMsg) {
  const s = String(errMsg || "").toLowerCase();
  return (
    s.includes("rate limit") ||
    s.includes("429") ||
    s.includes("tpm") ||
    s.includes("quota") ||
    s.includes("insufficient") ||
    s.includes("billing") ||
    s.includes("hard limit") ||
    s.includes("credits")
  );
}

/* ----------------- SESSION + MODE (per chat) ----------------- */
function sessionState(m) {
  const c = getChatPrefs(m);
  return {
    on: !!c.session_on,
    mode: (c.session_mode || "tag").toLowerCase(), // tag | all
  };
}
function setSession(m, on) { return setChatPrefs(m, { session_on: !!on }); }
function setMode(m, mode) {
  mode = String(mode || "").toLowerCase();
  if (!["tag", "all"].includes(mode)) return null;
  setChatPrefs(m, { session_mode: mode });
  return mode;
}

/* ----------------- TAG DETECTION (robust) ----------------- */
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
function bgUrl() { return (process.env.CRYS_MENU_BG || "").trim(); }
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(res.headers.location));
      }
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
  for (const ln of lines) { ctx.fillText(String(ln), pad, y); y += lineH; }

  ctx.font = `${Math.round(size * 0.028)}px Sans`;
  ctx.fillStyle = theme.neon;
  ctx.fillText("CRYSNOVA AI • v3", pad, h - pad);

  return canvas.toBuffer("image/png");
}

/* [PART 1 END] */
/* ----------------- AI CORE ----------------- */
function baseSystem(mode) {
  const modeHint = {
    chat: "Be friendly, sharp, Nigerian-street-smart but respectful. English + small Pidgin mix when it fits.",
    coach: "Be a practical coach. Give steps, plans, checklists.",
    writer: "Write premium content: captions, bios, scripts, hooks. Give 3 options + best pick.",
    coder: "Debug + explain simply. Give clean code and how to paste it into KORD plugins.",
    translate: "Translate cleanly. Keep meaning + tone. If Pidgin requested, do Naija Pidgin well.",
    summarize: "Summarize clearly into bullets, actions, and key points.",
    roast: "Generate playful banter only. No slurs, hate, threats, or family curses. Keep it witty.",
    auto: "You are replying in WhatsApp. Keep it short, helpful, and natural. Avoid long essays."
  }[mode] || "Be helpful.";

  return (
    "You are CRYSNOVA AI, a premium WhatsApp assistant.\n" +
    "Rules:\n" +
    "- Keep responses concise but premium.\n" +
    "- Never output hate, slurs, threats, doxxing, or sexual content.\n" +
    "- If asked for harmful content, refuse and redirect.\n" +
    "Mode:\n" + modeHint
  );
}

async function callOpenAI(client, model, messages, temperature) {
  return await client.chat.completions.create({
    model,
    messages,
    temperature,
  });
}

async function aiReply(m, userText, mode = "chat") {
  if (!openai1) throw new Error("OPENAI_API_KEY not set.");

  // cooldown per chat
  const cdKey = "chat::" + getChatId(m);
  const left = checkCooldownKey(cdKey);
  if (left) throw new Error(`Cooldown: wait ${left}s`);

  const history = loadMem(m).map(x => ({ role: x.role, content: x.content }));
  const messages = [
    { role: "system", content: baseSystem(mode) },
    ...history.slice(-memCap()),
    { role: "user", content: userText }
  ];

  const temp = (mode === "roast") ? 0.95 : 0.7;

  try {
    const resp = await callOpenAI(openai1, MODEL, messages, temp);
    const out = resp?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error("AI returned empty response.");
    pushMem(m, "user", userText);
    pushMem(m, "assistant", out);
    return out;
  } catch (e) {
    const msg = e?.message || String(e);

    // fallback model / key
    if (shouldFallback(msg) && (openai2 || FALLBACK_MODEL)) {
      try {
        const client2 = openai2 || openai1;
        const model2 = FALLBACK_MODEL || MODEL;
        const resp2 = await callOpenAI(client2, model2, messages, temp);
        const out2 = resp2?.choices?.[0]?.message?.content?.trim();
        if (!out2) throw new Error("AI returned empty response (fallback).");
        pushMem(m, "user", userText);
        pushMem(m, "assistant", out2);
        return out2;
      } catch (e2) {
        throw new Error((e2?.message || String(e2)) + " (fallback)");
      }
    }

    throw new Error(msg);
  }
}

/* ----------------- WEATHER + MUSIC ----------------- */
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

/* ----------------- MENU ----------------- */
function menuLines(m) {
  const p = SAFE_PREFIX();
  const st = sessionState(m);
  const sch = getSched();
  const tg = listTargets();
  return [
    `SESSION: ${st.on ? "ON" : "OFF"} • MODE: ${st.mode.toUpperCase()}`,
    `SCHED: ${sch.enabled ? "ON" : "OFF"} • ON ${sch.onTime} • OFF ${sch.offTime}`,
    `TARGETS: ${tg.length}`,
    "",
    `${p}crysnova on`,
    `${p}crysnova off`,
    `${p}crysnova mode tag`,
    `${p}crysnova mode all`,
    `${p}crysnova status`,
    "",
    `${p}crysnova targets add`,
    `${p}crysnova targets del`,
    `${p}crysnova targets list`,
    `${p}crysnova sched on`,
    `${p}crysnova sched off`,
    `${p}crysnova sched seton HH:MM`,
    `${p}crysnova sched setoff HH:MM`,
    `${p}crysnova sched msgon <text>`,
    `${p}crysnova sched msgoff <text>`,
    "",
    "AI MODES",
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
    `${p}crysnova lastroast  (reply)`,
    `${p}crysnova roastlevel <soft|medium|savage>`,
    "",
    "UTILS",
    `${p}crysnova weather <city>`,
    `${p}crysnova setcity <city>`,
    `${p}crysnova music <query>`,
    "",
    "MEMORY",
    `${p}crysnova mem`,
    `${p}crysnova memclear`
  ];
}

async function sendMenu(m) {
  const img = await makeMenuCard("CRYSNOVA AI", menuLines(m), 900);
  if (img) return sendImage(m, img, "");
  return sendText(m, "CRYSNOVA AI\n\n" + menuLines(m).join("\n"));
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

/* [PART 2 END] */
/* ----------------- SCHEDULER ENGINE ----------------- */
let schedJobsStarted = false;

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

async function broadcastToTargets(client, text) {
  const targets = listTargets();
  if (!targets.length) return;

  for (const jid of targets) {
    try {
      await client.sendMessage(jid, { text });
    } catch {}
  }
}

function startSchedulerOnce(client) {
  if (schedJobsStarted) return;
  schedJobsStarted = true;

  // Runs every minute; checks if sched enabled and time matches
  cron.schedule("* * * * *", async () => {
    try {
      const sch = getSched();
      if (!sch.enabled) return;

      const onT = parseHHMM(sch.onTime);
      const offT = parseHHMM(sch.offTime);
      if (!onT || !offT) return;

      const now = new Date();
      const hh = now.getHours();
      const mm = now.getMinutes();

      // ON
      if (hh === onT.hh && mm === onT.mm) {
        const targets = listTargets();
        for (const jid of targets) {
          try {
            // set chat session for each target chat
            // (fake a minimal m object for setters)
            setChatPrefs({ chat: jid, key: { remoteJid: jid } }, { session_on: true });
          } catch {}
        }
        await broadcastToTargets(client, sch.msgOn || "CRYSNOVA session enabled.");
      }

      // OFF
      if (hh === offT.hh && mm === offT.mm) {
        const targets = listTargets();
        for (const jid of targets) {
          try {
            setChatPrefs({ chat: jid, key: { remoteJid: jid } }, { session_on: false });
          } catch {}
        }
        await broadcastToTargets(client, sch.msgOff || "CRYSNOVA session disabled.");
      }
    } catch {
      return;
    }
  }, { timezone: "Africa/Lagos" });
}

/* ----------------- MAIN COMMAND ----------------- */
kord(
  {
    cmd: "crysnova|crys",
    desc: "Crysnova AI (premium assistant + session auto-reply + scheduler)",
    fromMe: wtype,
    type: "tools",
    react: "💎",
  },
  async (m, text) => {
    try {
      // start scheduler (safe)
      if (m?.client) startSchedulerOnce(m.client);

      const raw = getTextFromAny(m, text).trim();
      const args = raw.split(/\s+/).filter(Boolean);

      // KORD cores differ: sometimes text already excludes subcommand.
      // So we also read from full message and remove "crysnova/crys" if present.
      let sub = (args[0] || "menu").toLowerCase();
      let rest = args.slice(1).join(" ").trim();

      if (sub === "crysnova" || sub === "crys") {
        sub = (args[1] || "menu").toLowerCase();
        rest = args.slice(2).join(" ").trim();
      }

      const p = SAFE_PREFIX();

      // SESSION CONTROLS
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
        const st = sessionState(m);
        const sch = getSched();
        return sendText(
          m,
          `Session: ${st.on ? "ON" : "OFF"}\nMode: ${st.mode.toUpperCase()}\nScheduler: ${sch.enabled ? "ON" : "OFF"}\nTargets: ${listTargets().length}`
        );
      }

      // TARGETS
      if (sub === "targets") {
        if (!isAllowed(m)) return;
        const parts = rest.split(/\s+/).filter(Boolean);
        const act = (parts[0] || "").toLowerCase();

        if (act === "add") {
          addTarget(getChatId(m));
          return sendText(m, "Target added: this chat is now in scheduler/broadcast list.");
        }
        if (act === "del") {
          delTarget(getChatId(m));
          return sendText(m, "Target removed: this chat removed from scheduler/broadcast list.");
        }
        if (act === "clear") {
          clearTargets();
          return sendText(m, "Targets cleared.");
        }
        if (act === "list") {
          const t = listTargets();
          if (!t.length) return sendText(m, "No targets saved. Use: crysnova targets add (inside a group/DM)");
          return sendText(m, "Targets:\n" + t.map((x,i)=>`${i+1}. ${x}`).join("\n"));
        }
        return sendText(m, `Use:\n${p}crysnova targets add|del|list|clear`);
      }

      // SCHED
      if (sub === "sched") {
        if (!isAllowed(m)) return;
        const parts = rest.split(/\s+/).filter(Boolean);
        const act = (parts[0] || "").toLowerCase();
        const sch = getSched();

        if (act === "on") {
          setSched({ enabled: true });
          return sendText(m, `Scheduler ON.\nON: ${getSched().onTime}\nOFF: ${getSched().offTime}`);
        }
        if (act === "off") {
          setSched({ enabled: false });
          return sendText(m, "Scheduler OFF.");
        }
        if (act === "status") {
          const s = getSched();
          return sendText(m, `Scheduler: ${s.enabled ? "ON" : "OFF"}\nON: ${s.onTime}\nOFF: ${s.offTime}\nTargets: ${listTargets().length}`);
        }
        if (act === "seton") {
          const t = parts[1];
          if (!parseHHMM(t)) return sendText(m, "Use: crysnova sched seton HH:MM  (e.g. 12:00)");
          setSched({ onTime: t });
          return sendText(m, `Scheduler ON time set: ${t}`);
        }
        if (act === "setoff") {
          const t = parts[1];
          if (!parseHHMM(t)) return sendText(m, "Use: crysnova sched setoff HH:MM  (e.g. 05:00)");
          setSched({ offTime: t });
          return sendText(m, `Scheduler OFF time set: ${t}`);
        }
        if (act === "msgon") {
          const msg = parts.slice(1).join(" ").trim();
          if (!msg) return sendText(m, "Use: crysnova sched msgon <text>");
          setSched({ msgOn: msg });
          return sendText(m, "Scheduler ON message updated.");
        }
        if (act === "msgoff") {
          const msg = parts.slice(1).join(" ").trim();
          if (!msg) return sendText(m, "Use: crysnova sched msgoff <text>");
          setSched({ msgOff: msg });
          return sendText(m, "Scheduler OFF message updated.");
        }

        return sendText(
          m,
          `Scheduler commands:\n` +
          `${p}crysnova sched on|off|status\n` +
          `${p}crysnova sched seton HH:MM\n` +
          `${p}crysnova sched setoff HH:MM\n` +
          `${p}crysnova sched msgon <text>\n` +
          `${p}crysnova sched msgoff <text>`
        );
      }

      if (sub === "menu" || sub === "help") return sendMenu(m);

      if (sub === "setup") {
        const okAI = OPENAI_API_KEY ? "✅" : "❌";
        const okAI2 = OPENAI_API_KEY2 ? "✅" : "❌";
        const okW = (process.env.OPENWEATHER_API_KEY || "").trim() ? "✅" : "❌";
        return sendText(
          m,
          `SETUP\n` +
          `AI Key: ${okAI}\n` +
          `AI Key2: ${okAI2}\n` +
          `Model: ${MODEL}\n` +
          `Fallback: ${FALLBACK_MODEL}\n` +
          `Weather Key: ${okW}\n` +
          `Memory: ${memCap()} turns\n` +
          `Cooldown: ${cdSec()}s\n` +
          `Theme: ${(process.env.CRYS_THEME || "neon")}`
        );
      }

      // MEMORY
      if (sub === "mem") {
        const hist = loadMem(m);
        return sendText(m, `Memory saved: ${hist.length}/${memCap()}`);
      }
      if (sub === "memclear") {
        clearMem(m);
        return sendText(m, "Memory cleared for this chat/user.");
      }

      // ROAST SETTINGS
      if (sub === "roastlevel") {
        const lvl = setRoastLevel(m, rest);
        if (!lvl) return sendText(m, "Use: crysnova roastlevel soft|medium|savage");
        return sendText(m, `Roast level set: ${lvl}`);
      }

      // WEATHER
      if (sub === "setcity") {
        if (!rest) return sendText(m, "Use: crysnova setcity <city>");
        setPrefs(m, { city: rest });
        return sendText(m, `Default city set: ${rest}`);
      }
      if (sub === "weather") {
        const prefs = getPrefs(m);
        const city = rest || prefs.city;
        if (!city) return sendText(m, "Use: crysnova weather <city>  (or set default with crysnova setcity <city>)");
        const rep = await getWeather(city);
        return sendText(m, rep);
      }

      // MUSIC
      if (sub === "music") {
        if (!rest) return sendText(m, "Use: crysnova music <song or artist>");
        const result = await searchMusic(rest);
        await sendText(m, result.text);
        if (result.preview) {
          try {
            if (m?.client?.sendMessage) {
              return await m.client.sendMessage(getChatId(m), { audio: { url: result.preview }, mimetype: "audio/mp4" }, { quoted: m });
            }
          } catch {}
        }
        return null;
      }

      // SUMMARIZE QUOTED
      if (sub === "summarize") {
        const quoted = m?.quoted;
        const qtxt = quoted?.text || quoted?.msg || "";
        if (!qtxt) return sendText(m, "Reply to a message then use: crysnova summarize");
        const out = await aiReply(m, `Summarize this:\n\n${qtxt}`, "summarize");
        return sendText(m, out);
      }

      // ROAST (self / mention / lastroast)
      if (sub === "roast") {
        if (m?.mentionedJid?.length) {
          const user = m.mentionedJid[0];
          const roast = await doRoast(m, `@${user.split("@")[0]}`);
          return sendText(m, withMentions(`${roast}`, [user]));
        }
        const roast = await doRoast(m, "me");
        return sendText(m, roast);
      }
      if (sub === "lastroast") {
        const q = m?.quoted;
        if (!q) return sendText(m, "Reply to someone’s message, then use: crysnova lastroast");
        const user = q.sender;
        const roast = await doRoast(m, `@${String(user || "").split("@")[0] || "user"}`);
        return sendText(m, withMentions(`${roast}`, user ? [user] : []));
      }

      // AI MODES
      const modeMap = new Set(["chat","coach","writer","coder","translate"]);
      if (modeMap.has(sub)) {
        if (!rest) return sendText(m, `Use: ${p}crysnova ${sub} <message>`);
        const out = await aiReply(m, rest, sub);
        return sendText(m, out);
      }

      return sendText(m, `Unknown. Try: ${p}crysnova menu`);
    } catch (e) {
      return sendText(m, "❌ CRYSNOVA error: " + (e?.message || e));
    }
  }
);

/* ----------------- AUTO-REPLY LISTENER -----------------
   Session ON:
   - TAG mode: reply only when bot/owner is tagged
   - ALL mode: reply to everyone
   Skips commands to avoid replying to bot commands.
-------------------------------------------------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!m) return;
    if (m?.fromMe) return; // prevent loops

    // start scheduler
    if (m?.client) startSchedulerOnce(m.client);

    const st = sessionState(m);
    if (!st.on) return;

    // TAG mode requires mention
    if (st.mode === "tag" && !isTaggedForSession(m)) return;

    const txt = getTextFromAny(m, textArg).trim();
    if (!txt) return;

    // ignore messages that look like commands
    const p = SAFE_PREFIX();
    if (txt.startsWith(p)) return;

    // cooldown per chat for auto
    const cdKey = "auto::" + getChatId(m);
    const left = checkCooldownKey(cdKey);
    if (left) return;

    const name = m?.pushName ? String(m.pushName).trim() : "user";
    const prompt =
      `Reply to this WhatsApp message as CRYSNOVA AI.\n` +
      `Sender name: ${name}\n` +
      `Message: ${txt}\n\n` +
      `Reply short, helpful, and natural.`;

    const out = await aiReply(m, prompt, "auto");
    return sendText(m, out);
  } catch {
    return;
  }
});

module.exports = {};
/* [PART 3 END] */