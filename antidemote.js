/**
 * ANTI-DEMODE v1.0 — KORD WhatsApp Premium Plugin
 *
 * What it does:
 * - Detects when admins are demoted in a group
 * - Auto-promotes them back (if enabled + bot is admin)
 *
 * Commands (owner/sudo/mod):
 * - antidemote on
 * - antidemote off
 * - antidemote mode all
 * - antidemote mode list
 * - antidemote protect add @user
 * - antidemote protect remove @user
 * - antidemote protect list
 * - antidemote status
 *
 * Requirements:
 * - Bot must be ADMIN in the group
 *
 * Deps: none
 */

const fs = require("fs");
const path = require("path");
const { kord, wtype, config } = require("../core");

/* ----------------- STORAGE ----------------- */
const ROOT = "/home/container";
const DATA_DIR = path.join(ROOT, "cmds", ".antidemote");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ groups: {} }, null, 2));
}
function readDB() {
  ensure();
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { groups: {} }; }
}
function writeDB(db) {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function chatId(m) {
  return m?.chat || m?.key?.remoteJid || "unknown";
}
function senderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || "unknown";
}

/* ----------------- PERMISSION ----------------- */
function isAllowed(m) {
  if (m?.fromMe) return true;
  if (m?.isOwner) return true;
  if (m?.isSudo) return true;
  if (m?.isMod) return true;

  try {
    const sudoRaw = config?.SUDO || config?.SUDO_USERS || config?.SUDOS;
    const s = senderId(m);
    if (sudoRaw && s) {
      const list = Array.isArray(sudoRaw)
        ? sudoRaw
        : String(sudoRaw).split(",").map(x => x.trim()).filter(Boolean);
      if (list.includes(s)) return true;
    }
  } catch {}
  return false;
}

/* ----------------- GROUP STATE ----------------- */
function gkey(m) { return chatId(m); }

function getGroup_attach(db, gid) {
  if (!db.groups[gid]) {
    db.groups[gid] = {
      enabled: false,
      mode: "all",        // all | list
      protect: []         // jids
    };
  }
  return db.groups[gid];
}

/* ----------------- HELPERS ----------------- */
async function sendText(m, txt, opt = {}) {
  try { if (typeof m.send === "function") return await m.send(txt, opt); } catch {}
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(chatId(m), { text: txt, ...opt }, { quoted: m });
    }
  } catch {}
  try { if (typeof m.reply === "function") return await m.reply(txt); } catch {}
  return null;
}

function parseArgs(m, textArg) {
  const raw =
    (typeof textArg === "string" ? textArg : "") ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text || m?.body || "";
  return String(raw || "").trim().split(/\s+/).filter(Boolean);
}

function jidNum(j) {
  return String(j || "").split("@")[0];
}

/* ----------------- COMMAND ----------------- */
kord(
  {
    cmd: "antidemote|ad",
    desc: "Auto-restore demoted admins (group protection)",
    fromMe: wtype,
    type: "tools",
    react: "🛡️"
  },
  async (m, text) => {
    try {
      if (!m?.isGroup) return sendText(m, "This works only in groups.");

      const args = parseArgs(m, text);
      // args[0] = antidemote / ad
      const sub = (args[1] || "status").toLowerCase();
      const sub2 = (args[2] || "").toLowerCase();
      const sub3 = (args[3] || "").toLowerCase();

      const db = readDB();
      const gid = gkey(m);
      const g = getGroup_attach(db, gid);

      if (!isAllowed(m)) {
        return sendText(m, "Not allowed.");
      }

      if (sub === "on") {
        g.enabled = true;
        writeDB(db);
        return sendText(m, "ANTI-DEMODE enabled for this group.");
      }

      if (sub === "off") {
        g.enabled = false;
        writeDB(db);
        return sendText(m, "ANTI-DEMODE disabled for this group.");
      }

      if (sub === "mode") {
        const md = sub2;
        if (!["all", "list"].includes(md)) {
          return sendText(m, "Use: antidemote mode all  OR  antidemote mode list");
        }
        g.mode = md;
        writeDB(db);
        return sendText(m, `Mode set: ${md.toUpperCase()}`);
      }

      if (sub === "protect") {
        if (sub2 === "list") {
          const list = g.protect || [];
          if (!list.length) return sendText(m, "Protected list is empty.");
          return sendText(
            m,
            "Protected users:\n" + list.map(j => `• @${jidNum(j)}`).join("\n"),
            { mentions: list }
          );
        }

        if (sub2 === "add") {
          const target = m?.mentionedJid?.[0];
          if (!target) return sendText(m, "Mention a user: antidemote protect add @user");
          if (!g.protect.includes(target)) g.protect.push(target);
          writeDB(db);
          return sendText(m, `Added to protected list: @${jidNum(target)}`, { mentions: [target] });
        }

        if (sub2 === "remove") {
          const target = m?.mentionedJid?.[0];
          if (!target) return sendText(m, "Mention a user: antidemote protect remove @user");
          g.protect = (g.protect || []).filter(x => x !== target);
          writeDB(db);
          return sendText(m, `Removed from protected list: @${jidNum(target)}`, { mentions: [target] });
        }

        return sendText(m, "Use:\n- antidemote protect add @user\n- antidemote protect remove @user\n- antidemote protect list");
      }

      // STATUS
      return sendText(
        m,
        `ANTI-DEMODE STATUS\n` +
          `Enabled: ${g.enabled ? "YES" : "NO"}\n` +
          `Mode: ${String(g.mode || "all").toUpperCase()}\n` +
          `Protected: ${(g.protect || []).length}`
      );
    } catch (e) {
      return sendText(m, "❌ ANTI-DEMODE error: " + (e?.message || e));
    }
  }
);

/* ----------------- EVENT LISTENER -----------------
   This is the ONLY part you may need to adjust depending on your KORD core.

   We need the event that fires when group participants are updated
   (admin promoted/demoted). In Baileys it's usually: "group-participants.update"

   We try best-effort:
   - kord({ on: "group-participants.update" }, handler)
--------------------------------------------------- */

kord({ on: "group-participants.update" }, async (m) => {
  try {
    // Some cores pass a different payload for event listeners.
    // We attempt to read from m itself, OR from m.update / m.evdata patterns.
    const update = m?.update || m?.data || m?.ev || m || {};
    const id = update?.id || update?.jid || m?.chat || m?.key?.remoteJid;
    if (!id || !String(id).endsWith("@g.us")) return;

    const db = readDB();
    const g = getGroup_attach(db, id);
    if (!g.enabled) return;

    // Baileys typical structure:
    // update = { id: "xxx@g.us", participants: [...], action: "demote" }
    const action = String(update?.action || "").toLowerCase();
    const participants = update?.participants || [];

    if (action !== "demote") return;
    if (!participants.length) return;

    // Bot must be admin to promote
    // In many cores: m.client.groupMetadata(id) exists
    let isBotAdmin = false;
    let botJid = "";
    try {
      botJid = m?.client?.user?.id || m?.client?.user?.jid || "";
      if (botJid && !botJid.includes("@")) botJid = botJid + "@s.whatsapp.net";
      const meta = await m.client.groupMetadata(id);
      const me = meta?.participants?.find(p => p.id === botJid);
      isBotAdmin = !!me?.admin;
    } catch {
      // if we can't confirm, we still try promote; if fail, silently stop
      isBotAdmin = true;
    }

    if (!isBotAdmin) return;

    for (const victim of participants) {
      // Mode list: only protect selected
      if (String(g.mode || "all").toLowerCase() === "list") {
        if (!(g.protect || []).includes(victim)) continue;
      }

      // Promote back
      try {
        await m.client.groupParticipantsUpdate(id, [victim], "promote");
      } catch {
        // ignore promote failures (role hierarchy / permissions / rate-limits)
      }
    }
  } catch {
    return;
  }
});

module.exports = {};