/**
 * Anti-Demote PRO (Fixed, No Looping)
 * Commands:
 *  - antidemote on | off
 *  - antidemote mode all | selected
 *  - antidemote protectme
 *  - antidemote protect @user  (or reply a user)
 *  - antidemote unprotect @user (or reply a user)
 *  - antidemote list
 *  - antidemote status
 *
 * Notes:
 *  - Bot MUST be admin to restore promotion.
 *  - Loop protection included (recent-action guard).
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config } = require("../core");

/* ----------------- SAFE CONFIG ----------------- */
function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
}

function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}

function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || "unknown";
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
      : String(sudoRaw).split(",").map(x => x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

function ownerJidGuess(m) {
  // Prefer core-provided owner number
  const cfg = getCfgAny();
  const raw =
    cfg?.OWNER_NUMBER ||
    cfg?.OWNER ||
    cfg?.OWNERNUM ||
    process.env.OWNER_NUMBER ||
    process.env.OWNER ||
    "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits) return `${digits}@s.whatsapp.net`;

  // fallback: if m.isOwner is true, assume sender is owner
  if (m?.isOwner && m?.sender) return m.sender;

  return "";
}

async function sendText(m, text) {
  try { if (typeof m.reply === "function") return await m.reply(text); } catch {}
  try { if (typeof m.send === "function") return await m.send(text); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text }, { quoted: m });
    }
  } catch {}
}

/* ----------------- STORAGE ----------------- */
const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "antidemote_pro.json");

function ensureStore() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ groups: {} }, null, 2), "utf8");
    }
  } catch {}
}

function readDB() {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "{}"); } catch { return { groups: {} }; }
}

function writeDB(db) {
  ensureStore();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function getGroupState(gid) {
  const db = readDB();
  if (!db.groups) db.groups = {};
  if (!db.groups[gid]) {
    db.groups[gid] = {
      enabled: false,
      mode: "selected", // selected | all
      protected: []     // list of jids
    };
    writeDB(db);
  }
  return db.groups[gid];
}

function setGroupState(gid, patch) {
  const db = readDB();
  if (!db.groups) db.groups = {};
  db.groups[gid] = { ...(db.groups[gid] || { enabled:false, mode:"selected", protected:[] }), ...patch };
  writeDB(db);
  return db.groups[gid];
}

function normJid(j) {
  if (!j) return "";
  const s = String(j);
  if (s.includes("@")) return s;
  return `${s.replace(/\D/g, "")}@s.whatsapp.net`;
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

/* ----------------- LOOP / SPAM GUARDS ----------------- */
// When bot promotes someone, WhatsApp fires group-participants.update again.
// We skip handling if we recently acted on that target.
const RECENT = new Map(); // key = `${gid}::${jid}`, val = timestamp
const RECENT_WINDOW_MS = 12 * 1000;

function markRecent(gid, jid) {
  RECENT.set(`${gid}::${jid}`, Date.now());
}

function isRecent(gid, jid) {
  const t = RECENT.get(`${gid}::${jid}`) || 0;
  return Date.now() - t < RECENT_WINDOW_MS;
}

/* ----------------- BIND LISTENER ONCE ----------------- */
global.__ANTIDEMOTE_PRO_BOUND__ = global.__ANTIDEMOTE_PRO_BOUND__ || false;
async function botIsAdmin(client, gid) {
  try {
    const meta = await client.groupMetadata(gid);
    const me = client.user?.id || client.user?.jid || "";
    const myJid = me.includes("@") ? me : `${String(me).replace(/\D/g,"")}@s.whatsapp.net`;
    const p = (meta.participants || []).find(x => x.id === myJid);
    return !!(p && (p.admin === "admin" || p.admin === "superadmin"));
  } catch {
    return false;
  }
}

function shouldProtect(state, targetJid) {
  if (!state?.enabled) return false;
  if (state.mode === "all") return true;
  const list = (state.protected || []).map(normJid);
  return list.includes(normJid(targetJid));
}

async function restoreAdmin(client, gid, jid) {
  // Baileys: groupParticipantsUpdate(gid, [jid], "promote")
  await client.groupParticipantsUpdate(gid, [jid], "promote");
  markRecent(gid, jid);
}

/**
 * EVENT HANDLER
 * Fires when someone is promoted/demoted/added/removed.
 */
async function onGroupUpdate(client, update) {
  try {
    const gid = update?.id;
    const participants = update?.participants || [];
    const action = String(update?.action || "").toLowerCase(); // promote|demote|add|remove

    if (!gid || !participants.length) return;
    if (action !== "demote") return; // only care demote

    const state = getGroupState(gid);
    if (!state.enabled) return;

    // Bot must be admin
    const okAdmin = await botIsAdmin(client, gid);
    if (!okAdmin) return;

    for (const jid of participants) {
      const target = normJid(jid);

      // prevent looping (ignore if we just promoted them)
      if (isRecent(gid, target)) continue;

      // Decide if protected
      if (!shouldProtect(state, target)) continue;

      // Restore
      await restoreAdmin(client, gid, target);
    }
  } catch {
    // silent (don’t spam)
  }
}

/* Bind listener only once */
function bindOnce(client) {
  if (!client?.ev?.on) return false;
  if (global.__ANTIDEMOTE_PRO_BOUND__) return true;

  client.ev.on("group-participants.update", (u) => onGroupUpdate(client, u));
  global.__ANTIDEMOTE_PRO_BOUND__ = true;
  return true;
}

/* Helper: get target jid from mention or reply */
function getTargetJid(m) {
  if (Array.isArray(m?.mentionedJid) && m.mentionedJid.length) return normJid(m.mentionedJid[0]);
  if (m?.quoted?.sender) return normJid(m.quoted.sender);
  return "";
}

function statusText(gid) {
  const st = getGroupState(gid);
  return (
    `🛡️ ANTI-DEMOTE PRO\n` +
    `Enabled: ${st.enabled ? "YES" : "NO"}\n` +
    `Mode: ${String(st.mode || "selected").toUpperCase()}\n` +
    `Protected: ${(st.protected || []).length}`
  );
}
kord(
  {
    cmd: "antidemote|adp",
    desc: "Anti-Demote PRO (fixed)",
    fromMe: wtype,
    type: "tools",
    react: "🛡️",
  },
  async (m, text) => {
    try {
      const gid = getChatId(m);
      const raw = String(text || "").trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "status").toLowerCase();
      const state = getGroupState(gid);

      // Bind listener the first time any command runs (important)
      bindOnce(m?.client);

      // STATUS always allowed
      if (sub === "status") return sendText(m, statusText(gid));

      // Admin controls must be allowed
      if (!isAllowed(m)) return;

      if (sub === "on" || sub === "enable") {
        // auto-protect owner first
        const owner = ownerJidGuess(m);
        let list = state.protected || [];
        if (owner) list = uniq([...list, owner]);

        setGroupState(gid, { enabled: true, mode: state.mode || "selected", protected: list });
        return sendText(
          m,
          `${statusText(gid)}\n\n✅ Enabled.\n👑 Owner auto-protected.`
        );
      }

      if (sub === "off" || sub === "disable") {
        setGroupState(gid, { enabled: false });
        return sendText(m, `${statusText(gid)}\n\n🛑 Disabled.`);
      }

      if (sub === "mode") {
        const md = String(args[1] || "").toLowerCase();
        if (!["all", "selected"].includes(md)) {
          return sendText(m, "Use: antidemote mode all  OR  antidemote mode selected");
        }
        setGroupState(gid, { mode: md });
        return sendText(m, `${statusText(gid)}\n\n✅ Mode set: ${md.toUpperCase()}`);
      }

      if (sub === "protectme") {
        const me = ownerJidGuess(m) || normJid(getSenderId(m));
        const list = uniq([...(state.protected || []), me]);
        setGroupState(gid, { protected: list });
        return sendText(m, `${statusText(gid)}\n\n✅ Added you to protected.`);
      }

      if (sub === "protect") {
        const target = getTargetJid(m);
        if (!target) return sendText(m, "Tag a user or reply to them: antidemote protect @user");
        const list = uniq([...(state.protected || []), target]);
        setGroupState(gid, { protected: list });
        return sendText(m, `${statusText(gid)}\n\n✅ Protected: @${target.split("@")[0]}`);
      }

      if (sub === "unprotect") {
        const target = getTargetJid(m);
        if (!target) return sendText(m, "Tag a user or reply to them: antidemote unprotect @user");
        const list = (state.protected || []).map(normJid).filter(x => x !== normJid(target));
        setGroupState(gid, { protected: list });
        return sendText(m, `${statusText(gid)}\n\n✅ Removed: @${target.split("@")[0]}`);
      }

      if (sub === "list") {
        const list = (state.protected || []).map(normJid);
        if (!list.length) return sendText(m, `${statusText(gid)}\n\n(no protected users)`);
        const out = list.map((j, i) => `${i + 1}. @${j.split("@")[0]}`).join("\n");
        // mentions
        return m?.client?.sendMessage
          ? m.client.sendMessage(gid, { text: `🛡️ Protected List\n\n${out}`, mentions: list }, { quoted: m })
          : sendText(m, `🛡️ Protected List\n\n${out}`);
      }

      return sendText(
        m,
        "Commands:\n" +
        "• antidemote on | off\n" +
        "• antidemote mode all | selected\n" +
        "• antidemote protectme\n" +
        "• antidemote protect @user (or reply)\n" +
        "• antidemote unprotect @user (or reply)\n" +
        "• antidemote list\n" +
        "• antidemote status"
      );
    } catch (e) {
      return sendText(m, "❌ Anti-Demote error: " + (e?.message || e));
    }
  }
);

module.exports = {};