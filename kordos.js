// [KORD OS v2.0] PART 1/2
const fs = require("fs");
const path = require("path");
const { kord, wtype, config, prefix } = require("../core");

let Canvas = null;
try { Canvas = require("canvas"); } catch { Canvas = null; }

/* ---------------- SAFE CONFIG ---------------- */
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
function getVar(name, fallback = "") {
  const env = process.env?.[name];
  if (env !== undefined && env !== null && String(env).trim()) return String(env).trim();
  const cfg = getCfgAny();
  const v = cfg?.[name];
  if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  return fallback;
}

/* ---------------- ACCESS CONTROL ---------------- */
function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}
function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}
function isAllowed(m) {
  if (m?.fromMe || m?.isOwner || m?.isSudo || m?.isMod) return true;
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
async function safeReact(m, emoji) {
  try { if (typeof m.react === "function") return await m.react(emoji); } catch {}
  try { if (typeof m.reaction === "function") return await m.reaction(emoji); } catch {}
  try { if (typeof m.sendReaction === "function") return await m.sendReaction(emoji); } catch {}
  return null;
}
async function sendImage(m, buffer, caption = "") {
  try {
    if (typeof m.send === "function") return await m.send(buffer, { caption }, "image");
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      const jid = getChatId(m);
      return await m.client.sendMessage(jid, { image: buffer, caption }, { quoted: m });
    }
  } catch {}
  return m.reply ? m.reply(caption || "OK") : null;
}

/* ---------------- STORAGE (password) ---------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".kordos");
const PASS_FILE = path.join(DATA_DIR, "pass.json");
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }, null, 2));
}
function readPass() {
  ensureDirs();
  try {
    const j = JSON.parse(fs.readFileSync(PASS_FILE, "utf8"));
    return String(j.pass || "").trim();
  } catch { return ""; }
}
function writePass(p) {
  ensureDirs();
  fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: String(p || "").trim() }, null, 2));
}

/* ---------------- OS STATE ---------------- */
const OS = new Map(); // key -> session
const TTL = 7 * 60 * 1000;

function skey(m) { return `${getChatId(m)}::${getSenderId(m)}`; }

function getOS(m) {
  const k = skey(m);
  const s = OS.get(k);
  if (!s) return null;
  if (Date.now() - s.ts > TTL) { OS.delete(k); return null; }
  s.ts = Date.now(); OS.set(k, s);
  return s;
}
function setOS(m, patch) {
  const k = skey(m);
  const prev = OS.get(k) || {
    power: "off", screen: "off",
    user: getVar("KORDOS_USER", "Crysnova"),
    authed: false,
    awaitPass: false,
    ts: Date.now(),
    cwd: "~",
  };
  const next = { ...prev, ...patch, ts: Date.now() };
  OS.set(k, next);
  return next;
}
function clearOS(m) { OS.delete(skey(m)); }

function osTitle() { return getVar("KORDOS_NAME", "KORD OS"); }
function osTheme() { return getVar("KORDOS_THEME", "neon").toLowerCase(); }

const THEMES = {
  neon:   { a:"#071b12", b:"#0b2b1c", accent:"#27ff9a", text:"#eafff6" },
  ice:    { a:"#07121b", b:"#0a2233", accent:"#7df3ff", text:"#e8fbff" },
  hacker: { a:"#031006", b:"#062014", accent:"#00ff66", text:"#d8ffe9" },
  sunset: { a:"#1b0d07", b:"#33160a", accent:"#ff8a3d", text:"#fff0e6" },
  purple: { a:"#12071b", b:"#220a33", accent:"#c77dff", text:"#f4eaff" },
  gold:   { a:"#1b1407", b:"#33240a", accent:"#ffd166", text:"#fff7df" },
};
function T() { return THEMES[osTheme()] || THEMES.neon; }

/* ---------------- CANVAS SCREENS ---------------- */
async function renderDesktop({ header, lines = [], footer }) {
  if (!Canvas) return null;
  const { createCanvas } = Canvas;
  const W = 900, H = 520;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const t = T();

  // background gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.a);
  g.addColorStop(1, t.b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // glow border
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // panel
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(40, 40, W - 80, H - 80);

  // header
  ctx.fillStyle = t.accent;
  ctx.font = "bold 34px Sans";
  ctx.fillText(header || osTitle(), 64, 92);

  // divider
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 112);
  ctx.lineTo(W - 64, 112);
  ctx.stroke();

  // body
  ctx.fillStyle = t.text;
  ctx.font = "24px Sans";
  let y = 160;
  for (const ln of lines) {
    ctx.fillText(String(ln), 64, y);
    y += 34;
    if (y > H - 90) break;
  }

  // footer
  ctx.fillStyle = t.accent;
  ctx.font = "20px Sans";
  ctx.fillText(footer || "KORD • OS v2.0", 64, H - 58);

  return c.toBuffer("image/png");
}

async function showScreen(m, header, lines, footer, caption) {
  const img = await renderDesktop({ header, lines, footer });
  if (img) return sendImage(m, img, caption || "");
  // fallback to text if canvas missing
  const txt = `🖥️ ${header}\n\n` + lines.map((x) => `• ${x}`).join("\n");
  return m.reply ? m.reply(txt) : null;
}

function helpText() {
  const p = SAFE_PREFIX();
  return [
    `${p}os boot`,
    `${p}os login`,
    `${p}os desktop`,
    `${p}os open <app>`,
    `${p}os term`,
    `${p}os logout`,
    `${p}os shutdown`,
    `${p}os pass <newpass> (owner/mod)`,
  ];
}
// [KORD OS v2.0] PART 2/2

/* ---------------- OS BEHAVIOR ---------------- */
async function boot(m) {
  setOS(m, { power: "on", screen: "login", authed: false, awaitPass: false });
  await safeReact(m, "🟢");
  return showScreen(
    m,
    `${osTitle()} • BOOT`,
    [
      "Initializing core…",
      "Loading modules…",
      "Security checks passed ✅",
      "",
      "Type:  os login",
    ],
    null,
    "Type: os login"
  );
}

async function loginStart(m) {
  const pass = readPass();
  if (!pass) {
    return showScreen(
      m,
      "SECURITY SETUP",
      [
        "No OS password set yet.",
        "",
        "Owner/Mod: set it now:",
        `${SAFE_PREFIX()}os pass <newpass>`,
      ],
      null,
      "Set password first"
    );
  }
  setOS(m, { awaitPass: true, screen: "login" });
  await safeReact(m, "🔒");
  return showScreen(
    m,
    "LOGIN REQUIRED",
    [
      `User: ${getOS(m)?.user || "User"}`,
      "",
      "Reply with your password (within 60s).",
      "Or type: os cancel",
    ],
    null,
    "Reply with password"
  );
}

async function desktop(m) {
  const s = getOS(m) || setOS(m, {});
  if (!s.power || s.power === "off") return boot(m);
  if (!s.authed) return loginStart(m);

  setOS(m, { screen: "desktop", awaitPass: false });
  await safeReact(m, "🖥️");
  return showScreen(
    m,
    "DESKTOP",
    [
      "🧠 Brain",
      "📁 Files",
      "🎬 Media",
      "📦 Plugins",
      "💻 Terminal",
      "",
      "Type:  os open <app>",
      "Example: os open terminal",
    ],
    null,
    "os open <app>"
  );
}

async function openApp(m, app) {
  const s = getOS(m) || setOS(m, {});
  if (!s.power || s.power === "off") return boot(m);
  if (!s.authed) return loginStart(m);

  const a = String(app || "").trim().toLowerCase();
  if (!a) return desktop(m);

  if (a === "terminal" || a === "term") {
    setOS(m, { screen: "terminal" });
    await safeReact(m, "💻");
    return showScreen(
      m,
      "TERMINAL",
      [
        `KORD@os:${s.cwd}$`,
        "",
        "Commands:",
        "ls",
        "pwd",
        "run botmenu",
        "run livemenu",
        "back",
      ],
      null,
      "Type terminal command"
    );
  }

  if (a === "plugins") {
    setOS(m, { screen: "plugins" });
    await safeReact(m, "📦");
    return showScreen(
      m,
      "PLUGINS APP",
      [
        "Quick launch:",
        "run botmenu",
        "run livemenu",
        "run deploy",
        "",
        "Type: back",
      ],
      null,
      "Type: run <cmd> or back"
    );
  }

  setOS(m, { screen: "app", app: a });
  await safeReact(m, "📌");
  return showScreen(
    m,
    "APP OPENED",
    [
      `Opened: ${a}`,
      "",
      "This is a cinematic OS shell.",
      "Add your own app logic later.",
      "",
      "Type: back",
    ],
    null,
    "Type: back"
  );
}

async function shutdown(m) {
  clearOS(m);
  await safeReact(m, "🔻");
  return showScreen(m, "SHUTDOWN", ["Power off ✅"], null, "OS shutdown");
}

async function logout(m) {
  const s = getOS(m);
  if (!s) return shutdown(m);
  setOS(m, { authed: false, awaitPass: false, screen: "login" });
  await safeReact(m, "🚪");
  return showScreen(m, "LOGOUT", ["Session closed.", "Type: os login"], null, "Type: os login");
}

async function cancel(m) {
  const s = getOS(m);
  if (!s) return;
  setOS(m, { awaitPass: false });
  await safeReact(m, "❌");
  return showScreen(m, "CANCELLED", ["Action cancelled.", "Type: os desktop"], null, "Type: os desktop");
}

/* ---------------- TERMINAL ENGINE ---------------- */
async function runTerminal(m, cmdLine) {
  const s = getOS(m);
  if (!s || !s.authed) return loginStart(m);

  const raw = String(cmdLine || "").trim();
  const low = raw.toLowerCase();

  if (low === "back") return desktop(m);
  if (low === "pwd") return showScreen(m, "TERMINAL", [`${s.cwd}`], null, "");
  if (low === "ls") {
    return showScreen(m, "TERMINAL", ["brain  files  media  plugins  logs"], null, "");
  }
  if (low.startsWith("run ")) {
    const target = low.slice(4).trim();
    // we DO NOT execute shell. We only instruct user to run real commands.
    return showScreen(
      m,
      "LAUNCH",
      [
        `Requested: ${target}`,
        "",
        "This OS does not execute system commands.",
        "It triggers your normal bot commands.",
        "",
        `Now type: ${SAFE_PREFIX()}${target}`,
      ],
      null,
      `Type: ${SAFE_PREFIX()}${target}`
    );
  }

  return showScreen(
    m,
    "TERMINAL",
    [
      `Unknown: ${raw}`,
      "",
      "Try: ls | pwd | run botmenu | back",
    ],
    null,
    ""
  );
}

/* ---------------- COMMAND ROUTER ---------------- */
kord(
  { cmd: "os|kordos", desc: "KORD OS v2.0 (cinematic desktop)", fromMe: wtype, type: "tools", react: "🖥️" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      const arg = String(text || "").trim();
      const parts = arg.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "").toLowerCase();
      const rest = parts.slice(1).join(" ");

      if (!sub || sub === "help") {
        return showScreen(m, `${osTitle()} • HELP`, helpText(), null, "Use: os boot");
      }

      if (sub === "boot") return boot(m);
      if (sub === "desktop") return desktop(m);
      if (sub === "login") return loginStart(m);
      if (sub === "open") return openApp(m, rest);
      if (sub === "term") return openApp(m, "terminal");
      if (sub === "logout") return logout(m);
      if (sub === "shutdown") return shutdown(m);
      if (sub === "cancel") return cancel(m);

      if (sub === "pass") {
        if (!isAllowed(m)) return;
        const np = String(rest || "").trim();
        if (!np || np.length < 4) return m.reply("❌ Use: os pass <newpass> (min 4 chars)");
        writePass(np);
        await safeReact(m, "✅");
        return showScreen(m, "SECURITY", ["Password updated ✅", "Now: os login"], null, "Now: os login");
      }

      return showScreen(m, "UNKNOWN", ["Type: os help"], null, "os help");
    } catch (e) {
      return m.reply ? m.reply("❌ OS error: " + (e?.message || e)) : null;
    }
  }
);

/* ---------------- LISTENER (password + terminal input) ---------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;
    const s = getOS(m);
    if (!s) return;

    const raw =
      (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      "";
    const msg = String(raw || "").trim();
    if (!msg) return;

    // If user typed "os ..." it will be handled by command above, ignore here
    const low = msg.toLowerCase();
    if (low === "os" || low.startsWith("os ") || low === `${SAFE_PREFIX()}os` || low.startsWith(`${SAFE_PREFIX()}os `)) return;

    // password flow
    if (s.awaitPass) {
      const saved = readPass();
      if (!saved) { setOS(m, { awaitPass: false }); return; }
      if (msg !== saved) return showScreen(m, "LOGIN FAILED", ["❌ Wrong password", "Try again or: os cancel"], null, "");
      setOS(m, { authed: true, awaitPass: false, screen: "desktop" });
      await safeReact(m, "✅");
      return desktop(m);
    }

    // terminal flow (only if on terminal screen)
    if (s.screen === "terminal") {
      return runTerminal(m, msg);
    }

    // quick navigation shortcuts
    if (low === "back") return desktop(m);
  } catch {}
});