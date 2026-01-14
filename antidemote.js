/**
 * ANTI-DEMODE PRO v1.1 — Event + Watchdog Restore
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
 *  - antidemote mode all|selected
 *
 * IMPORTANT:
 *  - Bot MUST be admin to promote anyone.
 *  - This version works even if your core does NOT emit demote events.
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config } = require("../core");

/* ---------------- SAFE CONFIG ---------------- */
function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
}
function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
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
  if (m?.fromMe || m?.isOwner || m?.isSudo || m?.isMod) return true;
  const cfg = getCfgAny();
  const sudoRaw = cfg?.SUDO || cfg?.SUDO_USERS || cfg?.SUDOS;
  const sender = getSenderId(m);
  if (sudoRaw && sender) {
    const list = Array.isArray(sudoRaw)
      ? sudoRaw
      : String(sudoRaw).split(",").map(x => x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

/* ---------------- STORAGE ---------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "antidemote.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, JSON.stringify({ chats: {} }, null, 2), "utf8");
}
function readStore() {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); } catch { return { chats: {} }; }
}
function writeStore(db) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2), "utf8");
}
function chatKeyFromJid(jid) {
  return String(jid || "");
}
function getChatStateByJid(jid) {
  const db = readStore();
  const k = chatKeyFromJid(jid);
  return db.chats[k] || { enabled: false, mode: "selected", allAdmins: false, protected: [], lastAction: null };
}
function setChatStateByJid(jid, patch) {
  const db = readStore();
  const k = chatKeyFromJid(jid);
  const prev = db.chats[k] || { enabled: false, mode: "selected", allAdmins: false, protected: [], lastAction: null };
  db.chats[k] = { ...prev, ...patch, lastAction: Date.now() };
  writeStore(db);
  return db.chats[k];
}
function chatKey(m) { return getChatId(m); }
function getChatState(m) { return getChatStateByJid(chatKey(m)); }
function setChatState(m, patch) { return setChatStateByJid(chatKey(m), patch); }

function normalizeJid(j) {
  if (!j) return "";
  const s = String(j);
  if (s.includes("@")) return s;
  const digits = s.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : s;
}
function uniq(arr) {
  return Array.from(new Set((arr || []).map(normalizeJid).filter(Boolean)));
}

/* ---------------- BOT/OWNER ---------------- */
function getBotJid(m) {
  const a = m?.client?.user?.id || m?.client?.user?.jid || "";
  if (!a) return "";
  return String(a).includes("@") ? String(a) : `${String(a)}@s.whatsapp.net`;
}
function getOwnerJidGuess() {
  const cfg = getCfgAny();
  const n = cfg?.OWNER_NUMBER || cfg?.OWNER || cfg?.OWNERNUM || "";
  const digits = String(n || "").replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

/* ---------------- GROUP OPS ---------------- */
async function isBotAdmin(client, groupJid, botJid) {
  try {
    const meta = await client.groupMetadata(groupJid);
    const me = (meta?.participants || []).find(p => p.id === botJid);
    return !!(me && (me.admin === "admin" || me.admin === "superadmin"));
  } catch { return false; }
}

async function getAdmins(client, groupJid) {
  try {
    const meta = await client.groupMetadata(groupJid);
    return (meta?.participants || [])
      .filter(p => p.admin === "admin" || p.admin === "superadmin")
      .map(p => p.id);
  } catch { return []; }
}

async function promote(client, groupJid, jid) {
  return client.groupParticipantsUpdate(groupJid, [jid], "promote");
}

/* ---------------- UI ---------------- */
function statusCard(st) {
  return (
    "🛡️ ANTI-DEMODE PRO\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    `Enabled: ${st.enabled ? "YES" : "NO"}\n` +
    `Mode: ${(st.mode || "selected").toUpperCase()}\n` +
    `All Admins: ${st.allAdmins ? "ON" : "OFF"}\n` +
    `Protected: ${(st.protected || []).length}\n` +
    "━━━━━━━━━━━━━━━━━━\n" +
    "Tip:\n" +
    "• Bot must be admin to restore demotion\n" +
    "• v1.1 includes Watchdog restore"
  );
}

/* ---------------- CLIENT CACHE (for watchdog) ---------------- */
const LAST_CLIENT = new Map(); // groupJid -> client
function saveClientRef(m) {
  const jid = getChatId(m);
  if (jid && m?.client) LAST_CLIENT.set(jid, m.client);
}

/* ---------------- COMMANDS ---------------- */
kord(
  { cmd: "antidemote|antid", desc: "Premium Anti-Demote protection", fromMe: wtype, type: "tools", react: "🛡️" },
  async (m, arg) => {
    try {
      saveClientRef(m);

      const text = getText(m, arg);
      const parts = text.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "status").toLowerCase();

      const groupJid = getChatId(m);
      const isGroup = String(groupJid).endsWith("@g.us");

      if (!isGroup && sub !== "status") return m.reply("❌ Anti-demote works only in groups.");

      const st0 = getChatState(m);

      if (["on","off","add","remove","protectme","mode","alladmins"].includes(sub) && !isAllowed(m)) return;

      if (sub === "status") return m.reply(statusCard(st0));

      if (sub === "on") {
        const owner = normalizeJid(getOwnerJidGuess() || getSenderId(m));
        const st = setChatState(m, { enabled: true, protected: uniq([...(st0.protected||[]), owner]) });
        return m.reply("✅ Anti-demote enabled.\n\n" + statusCard(st));
      }

      if (sub === "off") {
        const st = setChatState(m, { enabled: false });
        return m.reply("🛑 Anti-demote disabled.\n\n" + statusCard(st));
      }

      if (sub === "protectme") {
        const me = normalizeJid(getSenderId(m));
        const st = setChatState(m, { protected: uniq([...(st0.protected||[]), me]) });
        return m.reply("✅ You are now protected.\n\n" + statusCard(st));
      }

      if (sub === "mode") {
        const md = (parts[1] || "").toLowerCase();
        if (!["all","selected"].includes(md)) return m.reply("❌ Use: antidemote mode all | selected");
        const st = setChatState(m, { mode: md });
        return m.reply(`✅ Mode set: ${md.toUpperCase()}\n\n${statusCard(st)}`);
      }

      if (sub === "alladmins") {
        const v = (parts[1] || "").toLowerCase();
        if (!["on","off"].includes(v)) return m.reply("❌ Use: antidemote alladmins on | off");
        const st = setChatState(m, { allAdmins: v === "on" });
        return m.reply(`✅ All Admins: ${v.toUpperCase()}\n\n${statusCard(st)}`);
      }

      if (sub === "add") {
        const mention = m?.mentionedJid?.[0];
        if (!mention) return m.reply("❌ Tag a user: antidemote add @user");
        const st = setChatState(m, { protected: uniq([...(st0.protected||[]), mention]) });
        return m.reply(`✅ Added: @${mention.split("@")[0]}`, { mentions: [mention] });
      }

      if (sub === "remove") {
        const mention = m?.mentionedJid?.[0];
        if (!mention) return m.reply("❌ Tag a user: antidemote remove @user");
        const st = setChatState(m, { protected: (st0.protected||[]).filter(x => normalizeJid(x) !== normalizeJid(mention)) });
        return m.reply(`✅ Removed: @${mention.split("@")[0]}`, { mentions: [mention] });
      }

      if (sub === "list") {
        const list = uniq(st0.protected || []);
        if (!list.length) return m.reply("Protected list is empty.");
        const lines = list.map(j => `• @${String(j).split("@")[0]}`);
        return m.reply("🧾 Protected Users:\n" + lines.join("\n"), { mentions: list });
      }

      return m.reply("❌ Unknown.\nUse: antidemote on|off|status|protectme|add|remove|list|mode|alladmins");
    } catch (e) {
      return m.reply("❌ Anti-demote error: " + (e?.message || e));
    }
  }
);

/* ---------------- EVENT LISTENER (best-effort) ----------------
   If your core emits demote events, this will act instantly.
--------------------------------------------------------------- */
kord({ on: "group-participants.update" }, async (m, update) => {
  try {
    if (!m?.client || !update) return;
    const groupJid = update.id || update.jid || update.chat;
    if (!groupJid || !String(groupJid).endsWith("@g.us")) return;

    saveClientRef({ ...m, key: { remoteJid: groupJid }, chat: groupJid, client: m.client });

    const st = getChatStateByJid(groupJid);
    if (!st.enabled) return;

    const action = String(update.action || "").toLowerCase();
    if (action !== "demote") return;

    const botJid = getBotJid(m);
    if (!botJid) return;

    const ok = await isBotAdmin(m.client, groupJid, botJid);
    if (!ok) return;

    let protectedSet = new Set(uniq(st.protected || []));
    if (st.allAdmins || String(st.mode).toLowerCase() === "all") {
      const admins = await getAdmins(m.client, groupJid);
      admins.forEach(a => protectedSet.add(normalizeJid(a)));
    }

    const targets = Array.isArray(update.participants) ? update.participants : [];
    for (const t of targets) {
      const jid = normalizeJid(t);
      if (!protectedSet.has(jid)) continue;
      try { await promote(m.client, groupJid, jid); } catch {}
    }
  } catch {}
});

/* ---------------- WATCHDOG (works even if events fail) ----------------
   Every 7 seconds:
   - For each enabled chat, checks protected users
   - If protected user is NOT admin anymore -> re-promote
----------------------------------------------------------------------- */
const WATCH_EVERY_MS = 7000;
let WATCH_RUNNING = false;

async function watchdogTick() {
  if (WATCH_RUNNING) return;
  WATCH_RUNNING = true;
  try {
    const db = readStore();
    const chats = db?.chats || {};

    for (const groupJid of Object.keys(chats)) {
      try {
        if (!String(groupJid).endsWith("@g.us")) continue;

        const st = chats[groupJid];
        if (!st?.enabled) continue;

        const client = LAST_CLIENT.get(groupJid);
        if (!client) continue; // no client ref yet (run a command in that group once)

        const meta = await client.groupMetadata(groupJid);
        const botJid = (client?.user?.id || client?.user?.jid || "");
        const botFull = botJid ? (String(botJid).includes("@") ? String(botJid) : `${botJid}@s.whatsapp.net`) : "";
        if (!botFull) continue;

        const me = (meta?.participants || []).find(p => p.id === botFull);
        const botIsAdmin = !!(me && (me.admin === "admin" || me.admin === "superadmin"));
        if (!botIsAdmin) continue;

        const adminsNow = (meta?.participants || [])
          .filter(p => p.admin === "admin" || p.admin === "superadmin")
          .map(p => normalizeJid(p.id));

        let protectedSet = new Set(uniq(st.protected || []));
        if (st.allAdmins || String(st.mode).toLowerCase() === "all") {
          adminsNow.forEach(a => protectedSet.add(a));
        }

        for (const jid of protectedSet) {
          // must be present in group participants
          const p = (meta?.participants || []).find(x => normalizeJid(x.id) === normalizeJid(jid));
          if (!p) continue;

          const isAdminNow = (p.admin === "admin" || p.admin === "superadmin");
          if (!isAdminNow) {
            try { await promote(client, groupJid, normalizeJid(jid)); } catch {}
          }
        }
      } catch {
        // ignore single chat failure
      }
    }
  } catch {
    // ignore
  } finally {
    WATCH_RUNNING = false;
  }
}

setInterval(watchdogTick, WATCH_EVERY_MS);

module.exports = {};