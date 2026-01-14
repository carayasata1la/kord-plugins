/**
 * ANTI-DEMODE PRO v1 — Premium Admin Protection (KORD / Baileys)
 *
 * Commands:
 *  - antidemote on
 *  - antidemote off
 *  - antidemote status
 *  - antidemote protectme
 *  - antidemote add @user
 *  - antidemote remove @user
 *  - antidemote list
 *  - antidemote alladmins on|off
 *  - antidemote mode all|selected   (all = protect all admins, selected = protect only list)
 *
 * REQUIREMENTS:
 *  - Bot MUST be admin in the group to re-promote someone.
 *
 * Notes:
 *  - When turned ON, it auto-protects owner (you) immediately.
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config } = require("../core");

/* ---------------- SAFE CONFIG ---------------- */
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

function getText(m, textArg) {
  return String(
    (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      ""
  ).trim();
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

/* ---------------- STORAGE ---------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "antidemote.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({ chats: {} }, null, 2),
      "utf8"
    );
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return { chats: {} };
  }
}

function writeStore(db) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2), "utf8");
}

function chatKey(m) {
  return getChatId(m);
}

function getChatState(m) {
  const db = readStore();
  const k = chatKey(m);
  const st = db.chats[k] || {
    enabled: false,
    mode: "selected", // selected|all
    allAdmins: false,
    protected: [],
    lastAction: null,
  };
  return st;
}

function setChatState(m, patch) {
  const db = readStore();
  const k = chatKey(m);
  const prev = db.chats[k] || {
    enabled: false,
    mode: "selected",
    allAdmins: false,
    protected: [],
    lastAction: null,
  };
  db.chats[k] = { ...prev, ...patch, lastAction: Date.now() };
  writeStore(db);
  return db.chats[k];
}

function normalizeJid(j) {
  if (!j) return "";
  const s = String(j);
  if (s.includes("@")) return s;
  // fallback: digits -> whatsapp jid
  const digits = s.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : s;
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

/* ---------------- BOT/OWNER JID HELPERS ---------------- */
function getBotJid(m) {
  const a = m?.client?.user?.id || m?.client?.user?.jid || "";
  if (!a) return "";
  return a.includes("@") ? a : `${a}@s.whatsapp.net`;
}

function getOwnerJidGuess() {
  const cfg = getCfgAny();
  const n = cfg?.OWNER_NUMBER || cfg?.OWNER || cfg?.OWNERNUM || "";
  const digits = String(n || "").replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

/* ---------------- GROUP HELPERS ---------------- */
async function getGroupAdmins(m, groupJid) {
  try {
    const meta = await m.client.groupMetadata(groupJid);
    const admins = (meta?.participants || [])
      .filter((p) => p.admin === "admin" || p.admin === "superadmin")
      .map((p) => p.id);
    return uniq(admins);
  } catch {
    return [];
  }
}

async function promote(m, groupJid, jid) {
  // Baileys: groupParticipantsUpdate(jid, participants, action)
  return m.client.groupParticipantsUpdate(groupJid, [jid], "promote");
}

async function isBotAdmin(m, groupJid) {
  try {
    const bot = getBotJid(m);
    if (!bot) return false;
    const meta = await m.client.groupMetadata(groupJid);
    const me = (meta?.participants || []).find((p) => p.id === bot);
    return !!(me && (me.admin === "admin" || me.admin === "superadmin"));
  } catch {
    return false;
  }
}

/* ---------------- UI ---------------- */
function statusCard(st) {
  const mode = (st.mode || "selected").toUpperCase();
  const enabled = st.enabled ? "YES" : "NO";
  const count = (st.protected || []).length;

  return (
    "🛡️ ANTI-DEMODE PRO\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    `Enabled: ${enabled}\n` +
    `Mode: ${mode}\n` +
    `All Admins: ${st.allAdmins ? "ON" : "OFF"}\n` +
    `Protected: ${count}\n` +
    "━━━━━━━━━━━━━━━━━━\n" +
    "Tip:\n" +
    "• Turn ON -> owner auto-protected\n" +
    "• Bot must be admin to restore demotion"
  );
}

/* ---------------- COMMANDS ---------------- */
kord(
  { cmd: "antidemote|antid", desc: "Premium Anti-Demote protection", fromMe: wtype, type: "tools", react: "🛡️" },
  async (m, arg) => {
    try {
      const text = getText(m, arg);
      const parts = text.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "status").toLowerCase();
      const st0 = getChatState(m);

      const groupJid = getChatId(m);
      const isGroup = groupJid.endsWith("@g.us");

      if (!isGroup && sub !== "status") {
        return m.reply("❌ Anti-demote works only in groups.");
      }

      if (["on", "off", "add", "remove", "protectme", "mode", "alladmins"].includes(sub)) {
        if (!isAllowed(m)) return;
      }

      if (sub === "status") return m.reply(statusCard(st0));

      if (sub === "on") {
        // Auto-protect owner first
        const owner = getOwnerJidGuess() || normalizeJid(getSenderId(m));
        const next = uniq([...(st0.protected || []), owner]);

        const st = setChatState(m, { enabled: true, protected: next });
        return m.reply("✓ Anti-demote enabled.\n\n" + statusCard(st));
      }

      if (sub === "off") {
        const st = setChatState(m, { enabled: false });
        return m.reply("🪫 Anti-demote disabled.\n\n" + statusCard(st));
      }

      if (sub === "protectme") {
        const owner = normalizeJid(getSenderId(m));
        const st = setChatState(m, { protected: uniq([...(st0.protected || []), owner]) });
        return m.reply(`✓ You are now protected.\n\n${statusCard(st)}`);
      }

      if (sub === "mode") {
        const md = (parts[1] || "").toLowerCase();
        if (!["all", "selected"].includes(md)) {
          return m.reply("❌ Use: antidemote mode all | selected");
        }
        const st = setChatState(m, { mode: md });
        return m.reply(`✓ Mode set: ${md.toUpperCase()}\n\n${statusCard(st)}`);
      }

      if (sub === "alladmins") {
        const v = (parts[1] || "").toLowerCase();
        if (!["on", "off"].includes(v)) {
          return m.reply("❌ Use: antidemote alladmins on | off");
        }
        const st = setChatState(m, { allAdmins: v === "on" });
        return m.reply(`✓ All Admins: ${v.toUpperCase()}\n\n${statusCard(st)}`);
      }

      if (sub === "add") {
        const mention = m?.mentionedJid?.[0];
        if (!mention) return m.reply("❌ Tag a user: antidemote add @user");
        const st = setChatState(m, { protected: uniq([...(st0.protected || []), mention]) });
        return m.reply(`✓ Added: @${mention.split("@")[0]}`, { mentions: [mention] });
      }

      if (sub === "remove") {
        const mention = m?.mentionedJid?.[0];
        if (!mention) return m.reply("❌ Tag a user: antidemote remove @user");
        const st = setChatState(m, { protected: (st0.protected || []).filter((x) => x !== mention) });
        return m.reply(`✓ Removed: @${mention.split("@")[0]}`, { mentions: [mention] });
      }

      if (sub === "list") {
        const list = st0.protected || [];
        if (!list.length) return m.reply("Protected list is empty.");
        const lines = list.map((j) => `• @${String(j).split("@")[0]}`);
        return m.reply("🧾 Protected Users:\n" + lines.join("\n"), { mentions: list });
      }

      return m.reply("❌ Unknown subcommand.\nUse: antidemote status | on | off | add | remove | list | protectme | mode | alladmins");
    } catch (e) {
      return m.reply("❌ Anti-demote error: " + (e?.message || e));
    }
  }
);

/* ---------------- DEMOTION LISTENER ----------------
   IMPORTANT:
   Your core must pass group update events to plugins.
   If your KORD uses a different event name, change only the "on" value below.
----------------------------------------------------- */

// ✓ Most Baileys-based cores emit "group-participants.update"
kord({ on: "group-participants.update" }, async (m, update) => {
  try {
    if (!m?.client || !update) return;

    const groupJid = update.id || update.jid || update.chat || "";
    if (!groupJid || !String(groupJid).endsWith("@g.us")) return;

    const st = getChatState({ ...m, chat: groupJid, key: { remoteJid: groupJid } });
    if (!st?.enabled) return;

    const action = String(update.action || "").toLowerCase();
    if (action !== "demote") return;

    const targets = Array.isArray(update.participants) ? update.participants : [];
    if (!targets.length) return;

    // We need a message context object that can query metadata/promote
    const fakeMsg = { ...m, chat: groupJid, key: { remoteJid: groupJid } };

    // Bot must be admin
    const botAdmin = await isBotAdmin(fakeMsg, groupJid);
    if (!botAdmin) return;

    // Determine protected set
    let protectedSet = new Set(st.protected || []);

    // Optionally protect all admins
    if (st.allAdmins || String(st.mode).toLowerCase() === "all") {
      const admins = await getGroupAdmins(fakeMsg, groupJid);
      admins.forEach((a) => protectedSet.add(a));
    }

    for (const t of targets) {
      const jid = normalizeJid(t);
      if (!protectedSet.has(jid)) continue;

      try {
        await promote(fakeMsg, groupJid, jid);
        // silent success (no spam)
      } catch {
        // ignore
      }
    }
  } catch {
    return;
  }
});

module.exports = {};