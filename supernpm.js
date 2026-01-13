const { kord, wtype, config, changeFont } = require("../core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "supernpm.json");

let running = null;

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
  // scrypt hash
  const key = crypto.scryptSync(String(pass), String(salt), 32);
  return key.toString("hex");
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

  // allow: name, @scope/name, and optional @version at end
  return /^(@[a-z0-9-_]+\/)?[a-z0-9-_.]+(@[a-z0-9-_.]+)?$/i.test(pkg);
}

// Optional blocklist (edit if you want)
const BLOCK = new Set([
  "node-pty",
  "pm2",
  "shelljs",
]);

function isBlocked(pkg) {
  const base = pkg.split("@")[0];
  return BLOCK.has(base.toLowerCase());
}

function usageText(prefixGuess = "") {
  const p = prefixGuess || "";
  return (
`┌════════════════════════════════════════┐
│ 🧰 SUPERNPM — SAFE INSTALLER            │
├────────────────────────────────────────┤
│ 01) ${p}supernpm setpass <newPass>
│ 02) ${p}supernpm install <pass> <pkg> [--save|--save-dev]
│ 03) ${p}supernpm status
│ 04) ${p}supernpm cancel
└════════════════════════════════════════┘

Example:
• ${p}supernpm setpass 4321
• ${p}supernpm install 4321 axios
• ${p}supernpm install 4321 chalk --save

Tip:
• Use short password you can remember.
• Owner only.

©️ by crysnova☠️ 2026`
  );
}

function getPrefixGuess() {
  // best effort; many cores expose prefix in config or env
  return process.env.PREFIX || config?.PREFIX || "";
}

/* ---------------- command ---------------- */

kord(
  {
    cmd: "supernpm",
    desc: "Owner-only npm installer (password set via WhatsApp)",
    fromMe: wtype,
    type: "tools",
  },
  async (m) => {
    try {
      if (!isAllowed(m)) return;

      const text = String(getText(m)).trim();
      const parts = text.split(/\s+/).slice(1); // after "supernpm"

      if (!parts.length) {
        return replyBox(m, usageText(getPrefixGuess()));
      }

      const sub = String(parts.shift() || "").toLowerCase();

      // HELP
      if (sub === "help") {
        return replyBox(m, usageText(getPrefixGuess()));
      }

      // SETPASS (owner sets from WhatsApp)
      if (sub === "setpass") {
        const pass = parts.join(" ").trim();
        if (!pass) return replyBox(m, "❌ Usage: supernpm setpass <newPass>");
        if (pass.length < 4) return replyBox(m, "❌ Password too short. Use at least 4 characters.");
        if (pass.length > 32) return replyBox(m, "❌ Password too long. Max 32 characters.");

        const salt = crypto.randomBytes(16).toString("hex");
        const hashed = hashPass(pass, salt);

        const store = loadStore();
        store.salt = salt;
        store.hash = hashed;
        store.setAt = Date.now();
        saveStore(store);

        return replyBox(m, "✅ SUPERNPM password set.\nUse: supernpm install <pass> <package>");
      }

      // STATUS
      if (sub === "status") {
        if (!running) return replyBox(m, "✅ No install running.");
        const secs = Math.floor((Date.now() - running.started) / 1000);
        return replyBox(
          m,
          `⏳ Running install:\n• ${running.pkg}\n• ${secs}s\n\nLast logs:\n${(running.log || "").slice(-2500) || "(no output yet)"}`
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

      // INSTALL
      if (sub === "install") {
        const store = loadStore();
        if (!store?.hash || !store?.salt) {
          return replyBox(m, "🔒 No password set.\nUse: supernpm setpass <newPass>");
        }

        const pass = parts.shift();
        if (!pass) return replyBox(m, "❌ Missing password.\nUsage: supernpm install <pass> <package>");

        const expected = store.hash;
        const got = hashPass(pass, store.salt);
        if (got !== expected) return replyBox(m, "❌ Wrong password.");

        if (running) {
          return replyBox(m, `⏳ An install is already running:\n${running.pkg}\nUse: supernpm status`);
        }

        const pkg = parts.shift();
        const flags = parts.filter((x) => ["--save", "--save-dev"].includes(x));

        if (!pkg) {
          return replyBox(m, "❌ Missing package.\nUsage: supernpm install <pass> <package[@ver]>");
        }
        if (!validPkg(pkg)) {
          return replyBox(m, "❌ Invalid package name.\nNo urls/git/file/shell chars allowed.");
        }
        if (isBlocked(pkg)) {
          return replyBox(m, `❌ Blocked package: ${pkg}`);
        }

        // Start
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
              ? `✅ Installed: ${pkg}\n\nIf the package needs rebuild/restart, restart your bot.\n\n--- last logs ---\n${tail}`
              : `❌ Install failed: ${pkg}\nExit code: ${code}\n\n--- last logs ---\n${tail}`;

          try { await replyBox(m, msg); } catch {}
        });

        return;
      }

      // unknown subcommand
      return replyBox(m, "❌ Unknown subcommand.\n\n" + usageText(getPrefixGuess()));
    } catch (e) {
      running = null;
      return replyBox(m, "❌ SUPERNPM error: " + (e?.message || e));
    }
  }
);