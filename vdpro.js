/**
 * VDPRO v2 — Disappearing Messages (Self-destruct command + Send to user)
 * File: /home/container/cmds/vdpro.js
 *
 * Commands:
 *  - .vdp <time?> <message>                 => send in current chat, delete after time (or default)
 *  - .vdp to <number|@mention> <time?> <msg> => send to target user, delete after time (or default)
 *  - .vdp set <time>                        => set default time (persist)
 *  - .vdp mode <silent|loud>                => toggle feedback
 *  - .vdp status                            => show config
 *
 * Notes:
 *  - Owner-only (fromMe: true)
 *  - Deletes the ORIGINAL command message immediately (best-effort)
 *  - No external npm deps
 */

const fs = require("fs");
const path = require("path");
const { kord } = require(process.cwd() + "/core");

/* -------------------- STORAGE -------------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".vdpro");
const CFG_FILE = path.join(DATA_DIR, "config.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CFG_FILE)) {
    fs.writeFileSync(CFG_FILE, JSON.stringify({ defaultMs: 10000, mode: "loud" }, null, 2));
  }
}

function readCfg() {
  ensureStore();
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
    const def = typeof j.defaultMs === "number" ? j.defaultMs : 10000;
    const mode = (j.mode || "loud").toLowerCase() === "silent" ? "silent" : "loud";
    return { defaultMs: def, mode };
  } catch {
    return { defaultMs: 10000, mode: "loud" };
  }
}

function writeCfg(cfg) {
  ensureStore();
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
}

/* -------------------- TIME PARSE -------------------- */
function parseTimeToMs(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase();

  // Allow: 2s, 10m, 1h, 1d
  const m = t.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  const unit = m[2];

  if (!Number.isFinite(n) || n <= 0) return null;

  let ms = 0;
  if (unit === "s") ms = n * 1000;
  if (unit === "m") ms = n * 60 * 1000;
  if (unit === "h") ms = n * 60 * 60 * 1000;
  if (unit === "d") ms = n * 24 * 60 * 60 * 1000;

  // Safety clamps
  const MIN = 3000;            // 3s minimum
  const MAX = 24 * 60 * 60 * 1000; // 24h max
  if (ms < MIN) ms = MIN;
  if (ms > MAX) ms = MAX;

  return ms;
}

function msToLabel(ms) {
  // For display only
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

/* -------------------- TARGET PARSE -------------------- */
function normalizeNumberToJid(x) {
  if (!x) return null;
  let s = String(x).trim();

  // accept @234..., +234..., 234...
  s = s.replace(/^@/, "").replace(/^\+/, "");

  // remove non-digits
  s = s.replace(/\D/g, "");

  if (!s || s.length < 8) return null;
  return `${s}@s.whatsapp.net`;
}

function extractMentionJid(m) {
  try {
    const ctx =
      m?.message?.extendedTextMessage?.contextInfo ||
      m?.message?.conversation?.contextInfo ||
      m?.message?.imageMessage?.contextInfo ||
      m?.message?.videoMessage?.contextInfo ||
      null;

    const mentioned = ctx?.mentionedJid;
    if (Array.isArray(mentioned) && mentioned[0]) return mentioned[0];
  } catch {}
  return null;
}

/* -------------------- DELETE HELPERS -------------------- */
async function deleteMessageBestEffort(m, key) {
  try {
    if (!key) return false;
    if (m?.client?.sendMessage) {
      await m.client.sendMessage(m.chat, { delete: key });
      return true;
    }
  } catch {}
  return false;
}

async function deleteMyCommandMessage(m) {
  // Delete the original .vdp command message immediately (best-effort)
  try {
    const key = m?.key;
    if (key) await deleteMessageBestEffort(m, key);
  } catch {}
}

/* -------------------- SEND HELPERS -------------------- */
async function sendTextTo(m, jidOrChat, text) {
  // returns { key } message object (best-effort)
  if (typeof m.send === "function") {
    // if m.send supports jid override, great; otherwise fallback
    try {
      // many KORD builds: m.client is better
      if (m?.client?.sendMessage) {
        const sent = await m.client.sendMessage(jidOrChat, { text }, { quoted: m });
        return sent;
      }
    } catch {}
  }

  if (m?.client?.sendMessage) {
    const sent = await m.client.sendMessage(jidOrChat, { text }, { quoted: m });
    return sent;
  }

  // Last resort: reply in same chat
  if (m.reply) await m.reply(text);
  return null;
}

/* -------------------- MAIN COMMAND -------------------- */
kord(
  {
    cmd: "vdp",
    desc: "VDPro v2 — disappearing messages (send to user + self-destruct command)",
    fromMe: true, // 🔒 owner-only
    type: "tools",
    react: "☠️",
  },
  async (m, text) => {
    const cfg = readCfg();
    const raw = String(text || "").trim();

    // Always try to delete the command message immediately
    // (Do it early so it vanishes even if the rest errors)
    await deleteMyCommandMessage(m);

    if (!raw) {
      return m.reply(
        "☠️ *VDP v2*\n\n" +
          "Usage:\n" +
          "• .vdp 2s hello\n" +
          "• .vdp hello (uses default)\n" +
          "• .vdp to 234xxxxxx 2s hello\n\n" +
          "Config:\n" +
          "• .vdp set 10s\n" +
          "• .vdp mode silent|loud\n" +
          "• .vdp status"
      );
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = (parts[0] || "").toLowerCase();

    // ----- CONFIG: set -----
    if (sub === "set") {
      const t = parts[1];
      const ms = parseTimeToMs(t);
      if (!ms) return m.reply("❌ Use: .vdp set 10s  (supports: s/m/h/d)");
      writeCfg({ ...cfg, defaultMs: ms });
      return m.reply(`✅ Default timer set to *${msToLabel(ms)}*`);
    }

    // ----- CONFIG: mode -----
    if (sub === "mode") {
      const mode = (parts[1] || "").toLowerCase();
      const val = mode === "silent" ? "silent" : "loud";
      writeCfg({ ...cfg, mode: val });
      return m.reply(`✅ VDP mode: *${val}*`);
    }

    // ----- CONFIG: status -----
    if (sub === "status") {
      return m.reply(
        "⚙️ *VDP Status*\n" +
          `• Default: *${msToLabel(cfg.defaultMs)}*\n` +
          `• Mode: *${cfg.mode}*`
      );
    }

    // ----- SEND FLOW -----
    let targetChat = m.chat; // default: current chat
    let idx = 0;

    if (sub === "to") {
      // .vdp to <jid|number|@mention> <time?> <msg...>
      const mention = extractMentionJid(m);
      const targetRaw = parts[1] || "";
      const jid = mention || normalizeNumberToJid(targetRaw);
      if (!jid) return m.reply("❌ Use: .vdp to 234xxxxxx 2s hello  (or tag the user)");
      targetChat = jid;
      idx = 2;
    }

    // optional time at parts[idx]
    let ms = null;
    const maybeTime = parts[idx];
    const parsed = parseTimeToMs(maybeTime);
    if (parsed) {
      ms = parsed;
      idx += 1;
    } else {
      ms = cfg.defaultMs;
    }

    const msg = parts.slice(idx).join(" ").trim();
    if (!msg) return m.reply("❌ Message cannot be empty.");

    // Send message
    const sent = await sendTextTo(m, targetChat, `🪲 ${msg}`);

    if (cfg.mode !== "silent") {
      const where = targetChat === m.chat ? "here" : `to *${String(targetChat).split("@")[0]}*`;
      await m.reply(`✅ Sent ${where}. Deletes in *${msToLabel(ms)}*`);
    }

    // Delete after delay (best-effort)
    setTimeout(async () => {
      try {
        if (sent?.key) {
          // delete in the same chat it was sent to
          await m.client.sendMessage(targetChat, { delete: sent.key });
        }
      } catch {}
    }, ms);
  }
);