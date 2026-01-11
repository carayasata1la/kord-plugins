const { exec } = require("child_process");
const { kord, wtype, config } = require("../core");

const SESSIONS = new Map();
const TTL = 2 * 60 * 1000;

function getPass() {
  return process.env.SHELL_PASS || "";
}

function isAllowed(m) {
  if (m?.fromMe || m?.isOwner || m?.isSudo) return true;
  return false;
}

function key(m) {
  return (m?.key?.remoteJid || "") + ":" + (m?.sender || "");
}

kord(
  {
    cmd: "shell",
    desc: "Secure shell (password protected)",
    fromMe: wtype,
    type: "owner",
  },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const args = (text || "").trim().split(" ");
    const sub = args.shift();
    const k = key(m);

    if (sub === "login") {
      if (!getPass()) return m.reply("❌ SHELL_PASS not set");
      if (args.join(" ") !== getPass())
        return m.reply("❌ Wrong password");

      SESSIONS.set(k, Date.now());
      return m.reply("✅ Shell unlocked (2 minutes)");
    }

    if (sub === "exit") {
      SESSIONS.delete(k);
      return m.reply("🔒 Shell locked");
    }

    if (sub === "run") {
      const ts = SESSIONS.get(k);
      if (!ts || Date.now() - ts > TTL) {
        SESSIONS.delete(k);
        return m.reply("🔒 Shell locked. Login again.");
      }

      const cmd = args.join(" ");
      if (!cmd) return m.reply("❌ No command");

      exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) return m.reply("❌ " + err.message);
        const out = (stdout || stderr || "").slice(0, 3500);
        return m.reply(out || "✅ Done");
      });
    }

    return m.reply(
      "Shell commands:\n.shell login <pass>\n.shell run <cmd>\n.shell exit"
    );
  }
);