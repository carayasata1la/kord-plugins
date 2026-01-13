const fs = require("fs");
const path = require("path");

const { kord } = require(process.cwd() + "/core");

/* -------------------- STORAGE -------------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".vdpro");
const CFG_FILE = path.join(DATA_DIR, "config.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CFG_FILE)) {
    fs.writeFileSync(
      CFG_FILE,
      JSON.stringify({ defaultDelayMs: 10000, mode: "loud" }, null, 2)
    );
  }
}

function readCfg() {
  ensureStore();
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
    return {
      defaultDelayMs: Number(j.defaultDelayMs) > 0 ? Number(j.defaultDelayMs) : 10000,
      mode: (String(j.mode || "loud").toLowerCase() === "silent") ? "silent" : "loud",
    };
  } catch {
    return { defaultDelayMs: 10000, mode: "loud" };
  }
}

function writeCfg(cfg) {
  ensureStore();
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
}

/* -------------------- TIME PARSER -------------------- */
function parseTimeToken(token) {
  // supports: 10s, 2m, 1h, 1d
  if (!token) return null;
  const t = String(token).trim().toLowerCase();
  const m = t.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = m[2];
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "d") return value * 24 * 60 * 60 * 1000;
  return null;
}

function clampDelay(ms) {
  // Safety clamp: 3 seconds min, 24 hours max (you can raise if you want)
  const min = 3000;
  const max = 24 * 60 * 60 * 1000;
  return Math.max(min, Math.min(max, ms));
}

/* -------------------- SAFE SEND HELPERS -------------------- */
async function safeReply(m, text) {
  try {
    if (typeof m.reply === "function") return await m.reply(text);
  } catch {}
  try {
    if (typeof m.send === "function") return await m.send(text);
  } catch {}
  return null;
}

async function safeSendText(m, text) {
  try {
    if (typeof m.send === "function") return await m.send(text);
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { text }, { quoted: m });
    }
  } catch {}
  return safeReply(m, text);
}

async function safeDelete(m, key) {
  // best-effort delete across bailey variants
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(m.chat, { delete: key });
    }
  } catch {}
  return null;
}

/* -------------------- VD COMMAND -------------------- */
kord(
  {
    cmd: "vd",
    desc: "VD PRO disappearing message",
    fromMe: true,
    type: "tools",
    react: "☠️",
  },
  async (m, text) => {
    try {
      const cfg = readCfg();
      const raw = String(text || "").trim();

      if (!raw) {
        return safeReply(
          m,
          "❌ Usage:\n• .vd <message>\n• .vd 10s <message>\n• .vd 2m <message>\n• .vd 1h <message>\n• .vd 1d <message>"
        );
      }

      // parse optional time token
      const parts = raw.split(/\s+/).filter(Boolean);
      const maybeTime = parseTimeToken(parts[0]);

      let delayMs = cfg.defaultDelayMs;
      let msg = raw;

      if (maybeTime) {
        delayMs = maybeTime;
        msg = parts.slice(1).join(" ").trim();
      }

      if (!msg) return safeReply(m, "❌ Message cannot be empty.");

      delayMs = clampDelay(delayMs);

      // send
      const sent = await safeSendText(m, `🫥 ${msg}`);

      // if we can't get the key, we can't delete
      const key = sent?.key || sent?.message?.key;
      if (!key) {
        if (cfg.mode === "loud") {
          return safeReply(m, "⚠️ Sent, but I couldn't capture message key to delete (bot framework limitation).");
        }
        return;
      }

      if (cfg.mode === "loud") {
        await safeReply(m, `⏳ Will delete in ${Math.round(delayMs / 1000)}s…`);
      }

      setTimeout(async () => {
        try {
          await safeDelete(m, key);
        } catch (e) {
          // don't crash
          console.log("[vdpro] delete failed:", e?.message || e);
        }
      }, delayMs);

    } catch (e) {
      return safeReply(m, "❌ VD error: " + (e?.message || e));
    }
  }
);

/* -------------------- CONFIG COMMAND -------------------- */
kord(
  {
    cmd: "vdpro",
    desc: "Configure VD PRO",
    fromMe: true,
    type: "tools",
    react: "⚙️",
  },
  async (m, text) => {
    try {
      const cfg = readCfg();
      const raw = String(text || "").trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "").toLowerCase();

      if (!sub || sub === "help") {
        return safeReply(
          m,
          "⚙️ VD PRO\n\n" +
            "Commands:\n" +
            "• .vdpro status\n" +
            "• .vdpro set <time>      (e.g. .vdpro set 15s / 2m / 1h)\n" +
            "• .vdpro mode <silent|loud>\n" +
            "• .vdpro cancel          (reset)\n\n" +
            "Use:\n• .vd <message>\n• .vd 30s <message>"
        );
      }

      if (sub === "status") {
        return safeReply(
          m,
          "⚙️ VD PRO STATUS\n" +
            `• defaultDelay: ${Math.round(cfg.defaultDelayMs / 1000)}s\n` +
            `• mode: ${cfg.mode}`
        );
      }

      if (sub === "set") {
        const tok = args[1];
        const ms = parseTimeToken(tok);
        if (!ms) return safeReply(m, "❌ Invalid time. Use: 10s / 2m / 1h / 1d");

        cfg.defaultDelayMs = clampDelay(ms);
        writeCfg(cfg);
        return safeReply(m, `✅ Default delay set to ${Math.round(cfg.defaultDelayMs / 1000)}s`);
      }

      if (sub === "mode") {
        const mode = (args[1] || "").toLowerCase();
        if (!["silent", "loud"].includes(mode)) return safeReply(m, "❌ Use: .vdpro mode silent OR .vdpro mode loud");
        cfg.mode = mode;
        writeCfg(cfg);
        return safeReply(m, `✅ Mode set to: ${mode}`);
      }

      if (sub === "cancel" || sub === "reset") {
        writeCfg({ defaultDelayMs: 10000, mode: "loud" });
        return safeReply(m, "✅ Reset done. Default = 10s, mode = loud.");
      }

      return safeReply(m, "❌ Unknown subcommand. Try: .vdpro help");
    } catch (e) {
      return safeReply(m, "❌ VDPRO error: " + (e?.message || e));
    }
  }
);