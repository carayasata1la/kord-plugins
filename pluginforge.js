// PLUGINFORGE v1 (PART 1/2)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { kord, wtype, config, prefix } = require("../core");

const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".pluginforge");
const PASS_FILE = path.join(DATA_DIR, "pass.json");

const AUTH_TTL = 5 * 60 * 1000;
const SESS_TTL = 12 * 60 * 1000;

const OUT_CHUNK = 2800;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }, null, 2));
}
function readPass() {
  ensure();
  try {
    const j = JSON.parse(fs.readFileSync(PASS_FILE, "utf8"));
    return String(j.pass || "").trim();
  } catch {
    return "";
  }
}
function writePass(p) {
  ensure();
  fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: String(p || "").trim() }, null, 2));
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

function safeCompare(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function getTextFromAny(m, textArg) {
  return String(
    (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      ""
  );
}

async function sendChunks(m, text) {
  const s = String(text || "");
  if (!s.trim()) return;
  for (let i = 0; i < s.length; i += OUT_CHUNK) {
    const part = s.slice(i, i + OUT_CHUNK);
    if (m?.reply) await m.reply(part);
  }
}

const SESS = new Map();
function skey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}
function now() { return Date.now(); }
function getSess(m) {
  const s = SESS.get(skey(m));
  if (!s) return null;
  if (s.ts && now() - s.ts > SESS_TTL) {
    SESS.delete(skey(m));
    return null;
  }
  s.ts = now();
  SESS.set(skey(m), s);
  return s;
}
function setSess(m, patch) {
  const prev = SESS.get(skey(m)) || {};
  const next = { ...prev, ...patch, ts: now() };
  SESS.set(skey(m), next);
  return next;
}
function clearSess(m) {
  SESS.delete(skey(m));
}
function isAuthed(m) {
  const s = getSess(m);
  return !!(s && s.authedUntil && now() < s.authedUntil);
}

function sanitizeName(name) {
  name = String(name || "").trim();
  name = name.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (!name) name = "myplugin";
  return name.slice(0, 40);
}

function sanitizeCmd(cmd) {
  cmd = String(cmd || "").trim();
  cmd = cmd.replace(/[^a-zA-Z0-9|_\-]/g, "");
  if (!cmd) cmd = "mycmd";
  return cmd.slice(0, 60);
}

function buildPluginTemplate(meta) {
  const pluginName = sanitizeName(meta.pluginName);
  const mainCmd = sanitizeCmd(meta.mainCmd);
  const desc = String(meta.desc || "KORD plugin").trim().slice(0, 120);
  const type = String(meta.type || "tools").trim().toLowerCase().slice(0, 30);
  const react = String(meta.react || "✨").trim().slice(0, 8);
  const fromMeFlag = meta.fromMe === false ? "false" : "wtype";

  const deps = Array.isArray(meta.deps) ? meta.deps : [];
  const depsHeader = deps.length
    ? `\n// npm i ${deps.join(" ")}\n`
    : "\n";

  const logic = String(meta.logic || "").trim();
  const finalLogic = logic
    ? logic
    : `// Your logic goes here\n// Example:\n// return m.reply("Hello from ${pluginName}!");`;

  return (
`${depsHeader}const { kord, wtype, config, prefix } = require("../core");

function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return ".";
}

function getTextFromAny(m, textArg) {
  return String(
    (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      ""
  );
}

kord(
  { cmd: "${mainCmd}", desc: "${desc.replace(/"/g, '\\"')}", fromMe: ${fromMeFlag}, type: "${type}", react: "${react}" },
  async (m, text) => {
    try {
      const pfx = SAFE_PREFIX();
      const input = getTextFromAny(m, text).trim();

      ${finalLogic}

    } catch (e) {
      return m.reply ? m.reply("❌ ${pluginName} failed: " + (e?.message || e)) : null;
    }
  }
);
`
  );
}

function parseDepsLine(s) {
  const t = String(s || "").trim();
  const m = t.match(/^deps\s*:\s*(.+)$/i);
  if (!m) return null;
  const raw = m[1];
  const deps = raw.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  return deps.slice(0, 12);
}
// PLUGINFORGE v1 (PART 2/2)
kord(
  { cmd: "pf|pluginforge", desc: "PluginForge: build plugins as text", fromMe: wtype, type: "tools", react: "🧩" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      ensure();
      const pfx = SAFE_PREFIX();
      const raw = String(text || "").trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "").toLowerCase();

      if (!sub || sub === "help") {
        return m.reply(
          "🧩 PLUGINFORGE v1\n\n" +
          "Commands:\n" +
          `• ${pfx}pf pass <newpass>        (set password)\n` +
          `• ${pfx}pf auth <pass>           (unlock 5 mins)\n` +
          `• ${pfx}pf new <name> <cmd>      (start)\n` +
          `• ${pfx}pf meta                 (shows what PF needs next)\n` +
          `• ${pfx}pf done                 (generate plugin)\n` +
          `• ${pfx}pf cancel               (cancel)\n\n` +
          "After pf new, send these lines (any order):\n" +
          "desc: ...\n" +
          "type: tools\n" +
          "react: ✨\n" +
          "fromme: true/false\n" +
          "deps: axios canvas\n\n" +
          "Then send your LOGIC lines (plain text). Finish with:\n" +
          `${pfx}pf done`
        );
      }

      if (sub === "pass") {
        const np = args.slice(1).join(" ").trim();
        if (!np) return m.reply(`Usage: ${pfx}pf pass <newpass>`);
        writePass(np);
        return m.reply("✅ PluginForge password set.");
      }

      if (sub === "auth") {
        const pw = args.slice(1).join(" ").trim();
        const saved = readPass();
        if (!saved) return m.reply(`🔒 No password set. Set with: ${pfx}pf pass <newpass>`);
        if (!pw) return m.reply(`Usage: ${pfx}pf auth <pass>`);
        if (!safeCompare(pw, saved)) return m.reply("❌ Wrong password.");
        setSess(m, { authedUntil: now() + AUTH_TTL });
        return m.reply("✅ PluginForge unlocked for 5 minutes.");
      }

      if (sub === "cancel") {
        clearSess(m);
        return m.reply("✅ PluginForge cancelled.");
      }

      if (sub === "new") {
        if (!isAuthed(m)) return m.reply(`🔒 Locked. Use: ${pfx}pf auth <pass>`);
        const pluginName = sanitizeName(args[1] || "");
        const mainCmd = sanitizeCmd(args[2] || "");
        if (!pluginName || !mainCmd) return m.reply(`Usage: ${pfx}pf new <name> <cmd>`);
        setSess(m, {
          mode: "collect",
          pluginName,
          mainCmd,
          desc: "",
          type: "tools",
          react: "✨",
          fromMe: true,
          deps: [],
          logicLines: [],
        });
        return m.reply(
          `🧩 Started: ${pluginName}\n` +
          `Cmd: ${mainCmd}\n\n` +
          "Now send:\n" +
          "desc: ...\n" +
          "type: tools\n" +
          "react: ✨\n" +
          "fromme: true/false\n" +
          "deps: axios canvas\n\n" +
          "Then paste your LOGIC lines.\n" +
          `Finish with: ${pfx}pf done`
        );
      }

      if (sub === "meta") {
        const s = getSess(m);
        if (!s || s.mode !== "collect") return m.reply(`No active build. Start: ${pfx}pf new <name> <cmd>`);
        return m.reply(
          "🧩 PF META\n" +
          `name: ${s.pluginName}\n` +
          `cmd: ${s.mainCmd}\n` +
          `desc: ${s.desc || "(not set)"}\n` +
          `type: ${s.type}\n` +
          `react: ${s.react}\n` +
          `fromme: ${s.fromMe}\n` +
          `deps: ${(s.deps || []).join(" ") || "(none)"}\n` +
          `logic lines: ${(s.logicLines || []).length}`
        );
      }

      if (sub === "done") {
        const s = getSess(m);
        if (!s || s.mode !== "collect") return m.reply(`No active build. Start: ${pfx}pf new <name> <cmd>`);
        const meta = {
          pluginName: s.pluginName,
          mainCmd: s.mainCmd,
          desc: s.desc || "KORD plugin",
          type: s.type || "tools",
          react: s.react || "✨",
          fromMe: s.fromMe !== false,
          deps: s.deps || [],
          logic: (s.logicLines || []).join("\n"),
        };
        const code = buildPluginTemplate(meta);
        clearSess(m);
        await m.reply("✅ Generated plugin code (TEXT). Copy all parts below in order:");
        return await sendChunks(m, code);
      }

      return m.reply(`Unknown subcommand. Try: ${pfx}pf help`);
    } catch (e) {
      return m.reply ? m.reply("❌ PF failed: " + (e?.message || e)) : null;
    }
  }
);

kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;
    const s = getSess(m);
    if (!s || s.mode !== "collect") return;

    const pfx = SAFE_PREFIX();
    const raw = getTextFromAny(m, textArg);
    if (!raw || !raw.trim()) return;

    const low = raw.trim().toLowerCase();
    if (low === `${pfx}pf done` || low === "pf done") return;
    if (low === `${pfx}pf cancel` || low === "pf cancel") return;

    const deps = parseDepsLine(raw);
    if (deps) {
      s.deps = deps;
      setSess(m, s);
      return m.reply("✅ deps set: " + deps.join(" "));
    }

    const mDesc = raw.match(/^desc\s*:\s*(.+)$/i);
    if (mDesc) { s.desc = String(mDesc[1] || "").trim(); setSess(m, s); return m.reply("✅ desc set."); }

    const mType = raw.match(/^type\s*:\s*(.+)$/i);
    if (mType) { s.type = String(mType[1] || "").trim().toLowerCase(); setSess(m, s); return m.reply("✅ type set."); }

    const mReact = raw.match(/^react\s*:\s*(.+)$/i);
    if (mReact) { s.react = String(mReact[1] || "").trim().slice(0, 8); setSess(m, s); return m.reply("✅ react set."); }

    const mFM = raw.match(/^fromme\s*:\s*(.+)$/i);
    if (mFM) {
      const v = String(mFM[1] || "").trim().toLowerCase();
      s.fromMe = !(v === "false" || v === "0" || v === "no");
      setSess(m, s);
      return m.reply("✅ fromme set: " + s.fromMe);
    }

    s.logicLines.push(raw.replace(/\u202a|\u202b|\u202c|\u202d|\u202e/g, ""));
    if (s.logicLines.length > 220) s.logicLines = s.logicLines.slice(0, 220);
    setSess(m, s);
  } catch {}
});