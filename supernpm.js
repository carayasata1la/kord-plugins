const { kord, wtype, config, changeFont } = require("../core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "supernpm.json");

let running = null;

// per-user auth session (like deployer)
const AUTH = new Map(); // key -> { until }
const AUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ---------------- helpers ---------------- */

function ensureStoreDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function loadStore() {
  ensureStoreDir();
  try {
    if (!fs.existsSync(STORE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function saveStore(obj) {
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function hashPass(pass, salt) {
  const key = crypto.scryptSync(String(pass), String(salt), 32);
  return key.toString("hex");
}

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
function userKey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}

function isAllowed(m) {
  if (m?.fromMe) return true;
  if (m?.isOwner) return true;
  if (m?.isSudo) return true;
  if (m?.isMod) return true;

  const sudoRaw = config?.SUDO || config?.SUDO_USERS || config?.SUDOS;
  if (sudoRaw && m?.sender) {
    const list = Array.isArray(sudoRaw)
      ? sudoRaw
      : String(sudoRaw).split(",").map((x) => x.trim()).filter(Boolean);
    if (list.includes(m.sender)) return true;
  }
  return false;
}

async function mono(txt) {
  try {
    return changeFont ? await changeFont(txt, "monospace") : txt;
  } catch {
    return txt;
  }
}

async function replyBox(m, txt) {
  const t = await mono(txt);
  if (typeof m.reply === "function") return m.reply("```" + t + "```");
  return m.send("```" + t + "```");
}

function getText(m) {
  return (
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text ||
    m?.body ||
    ""
  );
}

// Strict validation (no urls/git/file/shell chars)
function validPkg(pkg) {
  if (!pkg) return false;
  if (pkg.length > 80) return false;
  if (/[ \t\r\n]/.test(pkg)) return false;
  if (/[;&|`$<>\\]/.test(pkg)) return false;
  if (/^(https?:|git\+|git:|file:|ssh:)/i.test(pkg)) return false;
  if (pkg.includes("..")) return false;

  // allow: name, @scope/name, optional @version at end
  return /^(@[a-z0-9-_]+\/)?[a-z0-9-_.]+(@[a-z0-9-_.]+)?$/i.test(pkg);
}

// Optional blocklist
const BLOCK = new Set(["node-pty", "pm2", "shelljs"]);
function isBlocked(pkg) {
  const base = pkg.startsWith("@")
    ? pkg.split("/")[0] + "/" + (pkg.split("/")[1] || "")
    : pkg.split("@")[0];
  return BLOCK.has(String(base || "").toLowerCase());
}

function usageText(prefixGuess = "") {
  const p = prefixGuess || "";
  return (
`┌══════════════════════════════════════════┐
│ 🧰 SUPERNPM v2 — AUTH SESSION INSTALLER   │
├──────────────────────────────────────────┤
│ 01) ${p}supernpm setpass <newPass>
│ 02) ${p}supernpm auth <pass>        (unlock 5 mins)
│ 03) ${p}supernpm lock               (end session)
│ 04) ${p}supernpm i <pkg> [--save|--save-dev]
│ 05) ${p}supernpm status
│ 06) ${p}supernpm cancel
└══════════════════════════════════════════┘

Examples:
• ${p}supernpm setpass 11111
• ${p}supernpm auth 11111
• ${p}supernpm i axios
• ${p}supernpm i canvas --save

Notes:
• After auth, you DON'T type password again.
• Blocks URLs / git installs for safety.
• Restart bot if a package needs rebuild.`
  );
}

function getPrefixGuess() {
  return process.env.PREFIX || config?.PREFIX || "";
}

/* ------------- AUTH SESSION ------------- */
function isAuthed(m) {
  const k = userKey(m);
  const s = AUTH.get(k);
  if (!s) return false;
  if (Date.now() > s.until) {
    AUTH.delete(k);
    return false;
  }
  return true;
}

function setAuth(m) {
  AUTH.set(userKey(m), { until: Date.now() + AUTH_TTL_MS });
}

function clearAuth(m) {
  AUTH.delete(userKey(m));
}

/* ---------------- command ---------------- */

kord(
  {
    cmd: "supernpm",
    desc: "Owner-only npm installer (auth session)",
    fromMe: wtype,
    type: "tools",
  },
  async (m) => {
    try {
      if (!isAllowed(m)) return;

      const text = String(getText(m)).trim();
      const parts = text.split(/\s+/).slice(1); // after "supernpm"
      if (!parts.length) return replyBox(m, usageText(getPrefixGuess()));

      const sub = String(parts.shift() || "").toLowerCase();

      // HELP
      if (sub === "help") return replyBox(m, usageText(getPrefixGuess()));

      // SETPASS
      if (sub === "setpass") {
        const pass = parts.join(" ").trim();
        if (!pass) return replyBox(m, "❌ Usage: supernpm setpass <newPass>");
        if (pass.length < 4) return replyBox(m, "❌ Password too short (min 4).");
        if (pass.length > 32) return replyBox(m, "❌ Password too long (max 32).");

        const salt = crypto.randomBytes(16).toString("hex");
        const hashed = hashPass(pass, salt);

        const store = loadStore();
        store.salt = salt;
        store.hash = hashed;
        store.setAt = Date.now();
        saveStore(store);

        clearAuth(m);
        return replyBox(m, "✅ Password set.\nNow: supernpm auth <pass>");
      }

      // AUTH
      if (sub === "auth") {
        const store = loadStore();
        if (!store?.hash || !store?.salt) {
          return replyBox(m, "🔒 No password set.\nUse: supernpm setpass <newPass>");
        }

        const pass = parts.join(" ").trim();
        if (!pass) return replyBox(m, "❌ Usage: supernpm auth <pass>");

        const got = hashPass(pass, store.salt);
        if (got !== store.hash) return replyBox(m, "❌ Wrong password.");

        setAuth(m);
        return replyBox(
          m,
          `✅ Unlocked for ${Math.floor(AUTH_TTL_MS / 60000)} minutes.\nUse: supernpm i <pkg>`
        );
      }

      // LOCK
      if (sub === "lock") {
        clearAuth(m);
        return replyBox(m, "🔒 Locked. Use: supernpm auth <pass>");
      }

      // STATUS
      if (sub === "status") {
        const auth = isAuthed(m) ? "✅" : "❌";
        if (!running) return replyBox(m, `Auth: ${auth}\n✅ No install running.`);
        const secs = Math.floor((Date.now() - running.started) / 1000);
        return replyBox(
          m,
          `Auth: ${auth}\n⏳ Running:\n• ${running.pkg}\n• ${secs}s\n\nLast logs:\n${(running.log || "").slice(-2500) || "(no output yet)"}`
        );
      }

      // CANCEL
      if (sub === "cancel") {
        if (!running) return replyBox(m, "✅ No install running.");
        try {
          running.child.kill("SIGTERM");
          running = null;
          return replyBox(m, "🛑 Cancel requested.");
        } catch (e) {
          return replyBox(m, "❌ Cancel failed: " + (e?.message || e));
        }
      }

      // INSTALL ALIASES: i / install
      if (sub === "i" || sub === "install") {
        if (!isAuthed(m)) {
          return replyBox(m, "🔒 Locked.\nUse: supernpm auth <pass>");
        }

        if (running) {
          return replyBox(m, `⏳ Install already running:\n${running.pkg}\nUse: supernpm status`);
        }

        const pkg = parts.shift();
        const flags = parts.filter((x) => ["--save", "--save-dev"].includes(x));

        if (!pkg) return replyBox(m, "❌ Usage: supernpm i <package[@ver]> [--save|--save-dev]");
        if (!validPkg(pkg)) return replyBox(m, "❌ Invalid package name.\nNo urls/git/file/shell chars allowed.");
        if (isBlocked(pkg)) return replyBox(m, `❌ Blocked package: ${pkg}`);

        await replyBox(m, `📦 Installing: ${pkg}\nPlease wait...`);

        const args = ["install", pkg, ...flags, "--no-audit", "--no-fund"];
        const child = spawn("npm", args, { cwd: process.cwd(), shell: false });

        running = { pkg, child, started: Date.now(), log: "" };

        child.stdout.on("data", (d) => {
          running.log += d.toString();
          if (running.log.length > 15000) running.log = running.log.slice(-15000);
        });
        child.stderr.on("data", (d) => {
          running.log += d.toString();
          if (running.log.length > 15000) running.log = running.log.slice(-15000);
        });

        child.on("close", async (code) => {
          const out = running?.log || "";
          running = null;

          const tail = out.slice(-3500);
          const msg =
            code === 0
              ? `✅ Installed: ${pkg}\n\n--- last logs ---\n${tail}`
              : `❌ Install failed: ${pkg}\nExit code: ${code}\n\n--- last logs ---\n${tail}`;

          try { await replyBox(m, msg); } catch {}
        });

        return;
      }

      return replyBox(m, "❌ Unknown subcommand.\n\n" + usageText(getPrefixGuess()));
    } catch (e) {
      running = null;
      return replyBox(m, "❌ SUPERNPM error: " + (e?.message || e));
    }
  }
);