/**
 * BANter v1 — Na Cruise 😄 (KORD)
 * File: /home/container/cmds/banter.js
 *
 * Commands:
 *  - banter [1-10]            (reply to a message OR tag a user)
 *  - banterme on|off          (opt-in/out for yourself)
 *  - bantercfg                (show settings)
 *  - bantercfg cooldown <sec> (owner/mod)
 *  - bantercfg ghost on|off   (owner/mod)  // ghost mention attempt
 *
 * Notes:
 *  - OWNER/SUDO/MOD only (to prevent abuse).
 *  - Uses light Nigerian “cruise” lines (no hate/slurs).
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config } = require("../core");

/* ------------------ storage ------------------ */
const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".banter");
const DB_FILE = path.join(DATA_DIR, "banter.json");

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          settings: { cooldownSec: 6, ghostMention: true, maxBurst: 10 },
          optout: {}, // jid -> true
        },
        null,
        2
      )
    );
  }
}
function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { settings: { cooldownSec: 6, ghostMention: true, maxBurst: 10 }, optout: {} };
  }
}
function writeDB(db) {
  ensureDB();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ------------------ safe helpers ------------------ */
function getCfgAny() {
  try {
    if (typeof config === "function") return config() || {};
  } catch {}
  try {
    return config || {};
  } catch {
    return {};
  }
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
      : String(sudoRaw)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
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

function pickTargetJid(m) {
  // 1) replied message sender
  const q = m?.quoted;
  if (q?.sender) return q.sender;

  // 2) mention list
  const mentioned =
    m?.mentionedJid ||
    m?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    m?.msg?.contextInfo?.mentionedJid ||
    [];
  if (Array.isArray(mentioned) && mentioned.length) return mentioned[0];

  return null;
}

async function sendText(m, text, mentions = []) {
  try {
    if (typeof m.send === "function") {
      // many KORD builds: m.send(text, opts, type)
      return await m.send(text, { mentions }, "text");
    }
  } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text, mentions }, { quoted: m });
    }
  } catch {}
  return m.reply ? m.reply(text) : null;
}

async function safeReact(m, emoji) {
  try {
    if (typeof m.react === "function") return await m.react(emoji);
  } catch {}
  try {
    if (typeof m.reaction === "function") return await m.reaction(emoji);
  } catch {}
  try {
    if (typeof m.sendReaction === "function") return await m.sendReaction(emoji);
  } catch {}
  return null;
}

/* ------------------ cooldown ------------------ */
const COOLDOWN = new Map(); // key: chat::sender -> ts
function cdKey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}
function onCooldown(m, sec) {
  const k = cdKey(m);
  const last = COOLDOWN.get(k) || 0;
  const now = Date.now();
  if (now - last < sec * 1000) return true;
  COOLDOWN.set(k, now);
  return false;
}

/* ------------------ banter lines ------------------ */
// Light Nigerian “cruise” only (no slurs / hate / extreme abuse).
const LINES = [
  "Oga calm down 😄 your confidence dey run faster than your data.",
  "You dey form boss, but your Wi-Fi dey beg for mercy.",
  "Abeg no vex oo, na cruise. Your vibes be like NEPA: e dey go, e dey come.",
  "You too dey hot… like phone wey dey charge overnight 😂",
  "You sabi talk sha… but make your results match your mouth 😭",
  "See packaging! If swagger dey pay rent, you for don buy duplex.",
  "You dey argue like say you get backup battery for head 🤣",
  "No worry, I understand… not everybody’s update dey install complete.",
  "Your seriousness dey strong… but your planning dey soft 😅",
  "Omo you dey try… but your ‘try’ still dey load like 2G.",
  "You dey move like VIP… but your network dey behave like village.",
  "Na you be this? Sharp mouth, slow brain — na cruise oo 😂",
  "If confidence be food, you for don open restaurant.",
  "Your stubbornness fit power generator… steady!",
  "You dey form major… but your minor dey shout pass 😂",
  "Abeg rest small. Even Google dey refresh sometimes.",
  "You dey reason like philosopher… but your conclusion dey surprise person 😭",
  "Your energy loud… your accuracy quiet 😅",
  "You be like ringtone: always loud, sometimes unnecessary 😂",
  "No vex oo. I just dey test your BP with cruise 😄",
];

function randLine() {
  return LINES[Math.floor(Math.random() * LINES.length)];
}

/* ------------------ commands ------------------ */
kord(
  { cmd: "banter", desc: "Na cruise 😄 (reply or tag user)", fromMe: wtype, type: "fun", react: "😄" },
  async (m, arg) => {
    try {
      if (!isAllowed(m)) return;

      const db = readDB();
      const { cooldownSec, ghostMention, maxBurst } = db.settings || { cooldownSec: 6, ghostMention: true, maxBurst: 10 };

      // parse count
      const raw = String(arg || "").trim();
      const first = raw.split(/\s+/)[0];
      let count = parseInt(first, 10);
      if (!Number.isFinite(count)) count = 1;
      count = Math.max(1, Math.min(count, maxBurst || 10));

      if (onCooldown(m, cooldownSec || 6)) {
        await safeReact(m, "🕒");
        return m.reply ? m.reply(`⏳ Cooldown: wait ${cooldownSec}s`) : null;
      }

      const target = pickTargetJid(m);
      if (!target) {
        await safeReact(m, "⚠️");
        return m.reply ? m.reply("❌ Reply to a user’s message OR tag a user, then use: banter 1-10") : null;
      }

      if (db.optout && db.optout[target]) {
        await safeReact(m, "🛑");
        return m.reply ? m.reply("🛑 That user opted out of banter.") : null;
      }

      // Build output (no @ in text, optional “ghost mention”)
      const mentions = ghostMention ? [target] : [];
      const out = [];
      for (let i = 0; i < count; i++) out.push(`• ${randLine()}`);

      await safeReact(m, "😄");
      return await sendText(m, `😄 *BANTER (na cruise)*\n\n${out.join("\n")}`, mentions);
    } catch (e) {
      return m.reply ? m.reply("❌ banter failed: " + (e?.message || e)) : null;
    }
  }
);

kord(
  { cmd: "banterme", desc: "Opt in/out of banter", fromMe: wtype, type: "fun", react: "🧾" },
  async (m, arg) => {
    try {
      if (!isAllowed(m)) return;

      const mode = String(arg || "").trim().toLowerCase();
      if (!["on", "off"].includes(mode)) {
        return m.reply ? m.reply("Use: banterme on  OR  banterme off") : null;
      }

      const db = readDB();
      db.optout = db.optout || {};

      const me = getSenderId(m);
      if (mode === "off") db.optout[me] = true;
      if (mode === "on") delete db.optout[me];

      writeDB(db);
      await safeReact(m, "✅");
      return m.reply ? m.reply(`✅ Banter for you is now: *${mode.toUpperCase()}*`) : null;
    } catch (e) {
      return m.reply ? m.reply("❌ banterme failed: " + (e?.message || e)) : null;
    }
  }
);

kord(
  { cmd: "bantercfg", desc: "Banter settings", fromMe: wtype, type: "fun", react: "⚙️" },
  async (m, arg) => {
    try {
      if (!isAllowed(m)) return;

      const db = readDB();
      db.settings = db.settings || { cooldownSec: 6, ghostMention: true, maxBurst: 10 };

      const parts = String(arg || "").trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "").toLowerCase();

      // show
      if (!sub) {
        return m.reply
          ? m.reply(
              "⚙️ *BANTER SETTINGS*\n" +
                `• cooldownSec: ${db.settings.cooldownSec}\n` +
                `• ghostMention: ${db.settings.ghostMention ? "on" : "off"}\n` +
                `• maxBurst: ${db.settings.maxBurst}\n\n` +
                "Change:\n" +
                "• bantercfg cooldown 6\n" +
                "• bantercfg ghost on|off\n"
            )
          : null;
      }

      // change cooldown
      if (sub === "cooldown") {
        const sec = parseInt(parts[1], 10);
        if (!Number.isFinite(sec) || sec < 1 || sec > 60) {
          return m.reply ? m.reply("Use: bantercfg cooldown <1-60>") : null;
        }
        db.settings.cooldownSec = sec;
        writeDB(db);
        await safeReact(m, "✅");
        return m.reply ? m.reply(`✅ cooldownSec set to ${sec}s`) : null;
      }

      // ghost mention
      if (sub === "ghost") {
        const v = (parts[1] || "").toLowerCase();
        if (!["on", "off"].includes(v)) return m.reply ? m.reply("Use: bantercfg ghost on|off") : null;
        db.settings.ghostMention = v === "on";
        writeDB(db);
        await safeReact(m, "✅");
        return m.reply ? m.reply(`✅ ghostMention: ${v}`) : null;
      }

      return m.reply ? m.reply("Use: bantercfg  |  bantercfg cooldown <sec>  |  bantercfg ghost on|off") : null;
    } catch (e) {
      return m.reply ? m.reply("❌ bantercfg failed: " + (e?.message || e)) : null;
    }
  }
);