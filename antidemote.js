/**
 * ANTI-DEMOTE PRO v3 — Event + Audit Restore (Premium)
 *
 * What it does:
 * - Detects admin removals (demotions) and re-promotes protected users.
 * - Uses BOTH:
 *    1) group-participants.update event (fast)
 *    2) audit poller using groupMetadata diff (reliable)
 *
 * Limits (real WhatsApp limits):
 * - Bot MUST be admin to promote anyone.
 * - If bot loses admin too, it can't restore.
 * - Cannot block demotion before server — only restore after.
 *
 * Commands:
 *  - antidemote on
 *  - antidemote off
 *  - antidemote status
 *  - antidemote protectme
 *  - antidemote protect @user   (or reply)
 *  - antidemote unprotect @user (or reply)
 *  - antidemote mode selected|admins
 *  - antidemote audit on|off
 *  - antidemote interval <5-120>   (seconds)
 *  - antidemote list
 *
 * Mode:
 *  - selected: protect only list
 *  - admins: protect ALL current admins (auto)
 */

const fs = require("fs");
const path = require("path");

const { kord, wtype, config, prefix } = require("../core");

/* ----------------- SAFE CONFIG ----------------- */
function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
}
function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  const cfg = getCfgAny();
  if (cfg?.PREFIX && String(cfg.PREFIX).trim()) return String(cfg.PREFIX).trim();
  return ".";
}
function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}
function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
}
function isGroup(m) {
  const id = getChatId(m);
  return typeof id === "string" && id.endsWith("@g.us");
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
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { groups: {} }; }
}
function writeDB(db) {
  ensureStore();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}
function gkey(m) {
  return getChatId(m);
}

/* ----------------- OWNER/BOT JID HELPERS ----------------- */
function digitsOnly(x) { return String(x || "").replace(/\D/g, ""); }
function jidOfNumber(n) {
  const d = digitsOnly(n);
  return d ? `${d}@s.whatsapp.net` : "";
}
function getOwnerJidGuess() {
  const cfg = getCfgAny();
  const n = cfg?.OWNER_NUMBER || cfg?.OWNER || cfg?.OWNERNUM || cfg?.OWNER_NUM || "";
  return jidOfNumber(n);
}
function getBotJid(m) {
  const id = m?.client?.user?.id || m?.client?.user?.jid || "";
  if (id && typeof id === "string") return id.includes("@") ? id : `${id}@s.whatsapp.net`;
  return "";
}

/* ----------------- GROUP STATE ----------------- */
function getGroupState(m) {
  const db = readDB();
  const k = gkey(m);
  const g = db.groups[k] || {};
  return {
    enabled: !!g.enabled,
    mode: (g.mode || "selected").toLowerCase(), // selected|admins
    audit: (g.audit !== false), // default ON
    intervalSec: Math.max(5, Math.min(120, parseInt(g.intervalSec || 15, 10) || 15)),
    protected: Array.isArray(g.protected) ? g.protected : [],
    lastAdmins: Array.isArray(g.lastAdmins) ? g.lastAdmins : [],
    lastActionAt: g.lastActionAt || 0,
  };
}
function setGroupState(m, patch) {
  const db = readDB();
  const k = gkey(m);
  db.groups[k] = { ...(db.groups[k] || {}), ...patch };
  writeDB(db);
  return getGroupState(m);
}
function addProtected(m, jid) {
  const st = getGroupState(m);
  const set = new Set(st.protected);
  if (jid) set.add(jid);
  return setGroupState(m, { protected: [...set] });
}
function removeProtected(m, jid) {
  const st = getGroupState(m);
  const set = new Set(st.protected);
  set.delete(jid);
  return setGroupState(m, { protected: [...set] });
}

/* ----------------- SEND HELPERS ----------------- */
async function sendText(m, txt, opt = {}) {
  try { if (typeof m.send === "function") return await m.send(txt, opt); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(getChatId(m), { text: txt, ...opt }, { quoted: m });
    }
  } catch {}
  try { if (typeof m.reply === "function") return await m.reply(txt); } catch {}
  return null;
}
function mentionLine(jid) {
  const n = String(jid || "").split("@")[0];
  return `@${n}`;
}
/* ----------------- CORE: ADMIN SNAPSHOT + RESTORE ----------------- */

// tiny anti-loop: don’t try to re-promote same jid repeatedly within cooldown
const RECENT = new Map(); // key: group::jid -> ts
function canAct(groupId, jid, ms = 12000) {
  const k = `${groupId}::${jid}`;
  const now = Date.now();
  const last = RECENT.get(k) || 0;
  if (now - last < ms) return false;
  RECENT.set(k, now);
  return true;
}

// get fresh group metadata
async function fetchMeta(client, groupId) {
  if (!client) throw new Error("Client not found");
  // Most Baileys-based cores expose groupMetadata
  if (typeof client.groupMetadata === "function") {
    return await client.groupMetadata(groupId);
  }
  // Some expose through client.sock or client.conn
  if (client.sock && typeof client.sock.groupMetadata === "function") {
    return await client.sock.groupMetadata(groupId);
  }
  throw new Error("groupMetadata() not available in this core.");
}

function adminJidsFromMeta(meta) {
  // Baileys meta: participants[] with admin: "admin"|"superadmin"|null
  const parts = meta?.participants || [];
  const admins = [];
  for (const p of parts) {
    if (p?.admin === "admin" || p?.admin === "superadmin") admins.push(p.id);
  }
  return admins;
}

// decide who is protected
function computeProtectedSet(m, meta, st) {
  const set = new Set();

  // always protect owner first when enabled
  const owner = getOwnerJidGuess();
  if (owner) set.add(owner);

  // also protect bot jid (optional but useful)
  const bot = getBotJid(m);
  if (bot) set.add(bot);

  if (st.mode === "admins") {
    // protect ALL admins currently
    const admins = adminJidsFromMeta(meta);
    for (const a of admins) set.add(a);
  } else {
    // selected mode
    for (const p of st.protected) set.add(p);
  }
  return set;
}

// promote via client
async function promote(client, groupId, jid) {
  // Baileys: groupParticipantsUpdate(groupId, [jid], "promote")
  if (typeof client.groupParticipantsUpdate === "function") {
    return await client.groupParticipantsUpdate(groupId, [jid], "promote");
  }
  if (client.sock && typeof client.sock.groupParticipantsUpdate === "function") {
    return await client.sock.groupParticipantsUpdate(groupId, [jid], "promote");
  }
  throw new Error("groupParticipantsUpdate() not available in this core.");
}

// main restore logic: diff old admins vs new admins
async function handleAdminDiff(m, reason = "audit") {
  if (!m?.client) return;
  if (!isGroup(m)) return;

  const st = getGroupState(m);
  if (!st.enabled) return;

  const groupId = getChatId(m);

  const meta = await fetchMeta(m.client, groupId);
  const currentAdmins = adminJidsFromMeta(meta);

  // snapshot old admins (from DB)
  const oldAdmins = Array.isArray(st.lastAdmins) ? st.lastAdmins : [];

  // save new snapshot immediately (prevents repeated loops)
  setGroupState(m, { lastAdmins: currentAdmins });

  // who lost admin? (in old but not in new)
  const oldSet = new Set(oldAdmins);
  const newSet = new Set(currentAdmins);

  const lost = [];
  for (const a of oldSet) {
    if (!newSet.has(a)) lost.push(a);
  }
  if (!lost.length) return;

  const prot = computeProtectedSet(m, meta, st);

  // restore only if lost users are protected
  const toRestore = lost.filter(j => prot.has(j));
  if (!toRestore.length) return;

  // check if bot is still admin
  const bot = getBotJid(m);
  if (bot && !newSet.has(bot)) {
    // bot not admin: cannot restore
    return sendText(m,
      `🛡️ ANTI-DEMOTE PRO\n` +
      `Detected demote (${reason}) but I am not admin anymore.\n` +
      `Cannot restore: ${toRestore.map(mentionLine).join(", ")}`,
      { mentions: toRestore }
    );
  }

  // attempt promote back
  const restored = [];
  const failed = [];

  for (const jid of toRestore) {
    if (!canAct(groupId, jid)) continue;
    try {
      await promote(m.client, groupId, jid);
      restored.push(jid);
    } catch (e) {
      failed.push({ jid, err: e?.message || String(e) });
    }
  }

  if (restored.length || failed.length) {
    let msg =
      `🛡️ ANTI-DEMOTE PRO\n` +
      `Event: ${reason}\n`;

    if (restored.length) {
      msg += `✅ Restored: ${restored.map(mentionLine).join(", ")}\n`;
    }
    if (failed.length) {
      msg += `❌ Failed: ${failed.map(x => mentionLine(x.jid)).join(", ")}\n`;
      msg += `Tip: Bot must be admin + WhatsApp must allow promote.\n`;
    }

    return sendText(m, msg.trim(), { mentions: [...new Set([...restored, ...failed.map(x => x.jid)])] });
  }
}

/* ----------------- AUDIT POLLER ----------------- */
const POLLERS = new Map(); // groupId -> intervalRef

function stopPoller(groupId) {
  const t = POLLERS.get(groupId);
  if (t) clearInterval(t);
  POLLERS.delete(groupId);
}

function startPoller(m) {
  const groupId = getChatId(m);
  stopPoller(groupId);

  const st = getGroupState(m);
  if (!st.enabled || !st.audit) return;

  const interval = st.intervalSec * 1000;

  const ref = setInterval(async () => {
    try {
      // fake minimal message context for audits (reuse last seen m in this chat)
      await handleAdminDiff(m, "audit");
    } catch {
      // silent
    }
  }, interval);

  POLLERS.set(groupId, ref);
}
/* ----------------- COMMANDS ----------------- */
kord(
  {
    cmd: "antidemote|adp",
    desc: "Anti-Demote PRO (restore admin if demoted)",
    fromMe: wtype,
    type: "tools",
    react: "🛡️",
  },
  async (m, text) => {
    try {
      const p = SAFE_PREFIX();
      const raw = getTextFromAny(m, text).trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "status").toLowerCase();
      const rest = args.slice(1).join(" ").trim();

      if (!isGroup(m)) return sendText(m, "This works in groups only.");

      // OWNER/SUDO only for config
      const adminCmds = new Set(["on","off","mode","audit","interval","protect","unprotect","protectme"]);
      if (adminCmds.has(sub) && !isAllowed(m)) return;

      // ensure initial snapshot if needed
      async function ensureSnapshot() {
        const st = getGroupState(m);
        if (st.lastAdmins && st.lastAdmins.length) return;
        try {
          const meta = await fetchMeta(m.client, getChatId(m));
          const admins = adminJidsFromMeta(meta);
          setGroupState(m, { lastAdmins: admins });
        } catch {}
      }

      if (sub === "on") {
        await ensureSnapshot();
        // enable + auto protect owner
        const st = setGroupState(m, { enabled: true, audit: true });
        // also protect owner explicitly in selected mode list for clarity
        const owner = getOwnerJidGuess();
        if (owner) addProtected(m, owner);
        startPoller(m);
        return sendText(
          m,
          `🛡️ ANTI-DEMOTE PRO\nEnabled: YES\nMode: ${st.mode.toUpperCase()}\nAudit: ${st.audit ? "ON" : "OFF"}\nInterval: ${st.intervalSec}s\nProtected: ${getGroupState(m).protected.length}`
        );
      }

      if (sub === "off") {
        const groupId = getChatId(m);
        stopPoller(groupId);
        setGroupState(m, { enabled: false });
        return sendText(m, "🛡️ Anti-Demote disabled.");
      }

      if (sub === "mode") {
        const md = String(rest || "").toLowerCase();
        if (!["selected", "admins"].includes(md)) {
          return sendText(m, `Use: ${p}antidemote mode selected  OR  ${p}antidemote mode admins`);
        }
        setGroupState(m, { mode: md });
        startPoller(m);
        return sendText(m, `🛡️ Mode set: ${md.toUpperCase()}`);
      }

      if (sub === "audit") {
        const v = String(rest || "").toLowerCase();
        if (!["on","off"].includes(v)) return sendText(m, `Use: ${p}antidemote audit on|off`);
        setGroupState(m, { audit: v === "on" });
        startPoller(m);
        return sendText(m, `🛡️ Audit: ${v.toUpperCase()}`);
      }

      if (sub === "interval") {
        const n = parseInt(rest, 10);
        if (!Number.isFinite(n)) return sendText(m, `Use: ${p}antidemote interval 5-120`);
        const sec = Math.max(5, Math.min(120, n));
        setGroupState(m, { intervalSec: sec });
        startPoller(m);
        return sendText(m, `🛡️ Interval set: ${sec}s`);
      }

      if (sub === "protectme") {
        const me = getSenderId(m);
        const jid = me.includes("@") ? me : `${me}@s.whatsapp.net`;
        addProtected(m, jid);
        return sendText(m, `🛡️ Protected: ${mentionLine(jid)}`, { mentions: [jid] });
      }

      if (sub === "protect" || sub === "unprotect") {
        let target = null;

        // mention
        if (m?.mentionedJid?.length) target = m.mentionedJid[0];

        // reply
        if (!target && m?.quoted?.sender) target = m.quoted.sender;

        if (!target) {
          return sendText(m, `Reply someone or mention:\n${p}antidemote ${sub} @user`);
        }

        if (sub === "protect") addProtected(m, target);
        else removeProtected(m, target);

        return sendText(
          m,
          `🛡️ ${sub === "protect" ? "Added" : "Removed"}: ${mentionLine(target)}`,
          { mentions: [target] }
        );
      }

      if (sub === "list") {
        const st = getGroupState(m);
        const list = st.protected || [];
        if (!list.length) return sendText(m, "Protected list empty.");
        return sendText(
          m,
          `🛡️ Protected (${list.length}):\n` + list.map(mentionLine).join("\n"),
          { mentions: list }
        );
      }

      if (sub === "status") {
        const st = getGroupState(m);
        return sendText(
          m,
          `🛡️ ANTI-DEMOTE PRO\n` +
          `Enabled: ${st.enabled ? "YES" : "NO"}\n` +
          `Mode: ${st.mode.toUpperCase()}\n` +
          `Audit: ${st.audit ? "ON" : "OFF"}\n` +
          `Interval: ${st.intervalSec}s\n` +
          `Protected: ${(st.protected || []).length}\n\n` +
          `Tip: Bot must be ADMIN to restore demotion.`
        );
      }

      // manual force check
      if (sub === "check") {
        await handleAdminDiff(m, "manual-check");
        return;
      }

      return sendText(m, `Unknown.\nTry: ${p}antidemote status`);