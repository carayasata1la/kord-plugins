// cmds/defense.js
// ✨ LEGENDARY MUSTEQEEM DEFENSE SUITE ✨
// Menu + Toggles (Enforcement is done in event handlers!)

const protectedJids = new Set();
protectedJids.add('234xxxxxxxxxx@s.whatsapp.net'); // ← CHANGE TO YOUR REAL NUMBER!

function initDefense() {
  if (!global.defense) {
    global.defense = {
      godmode: {},
      antibug: {},
      antilink: {},   // chat -> 0..4
      antiword: {},   // chat -> Set
      lockdown: {}
    };
  }
  if (!global.msgStore) global.msgStore = {}; // for antibug (deleted msg restore)
}

module.exports = {
  command: ['defense', 'defenses', 'protect', 'shield'],
  alias: ['def', 'safe', 'guard'],
  category: 'defense',
  desc: 'Ultimate Defense Menu – Control all protection layers',
  group: true,
  admin: true,
  botAdmin: true,

  async execute(m, args) {
    initDefense();

    const chat = m.chat;
    const cmd = (args[0] || '').toLowerCase();

    // ── MAIN MENU ──────────────────────────────────────────
    if (!cmd || cmd === 'menu') {
      const antiwordCount = global.defense.antiword[chat]?.size || 0;
      const antilinkLevel = global.defense.antilink[chat] ?? 0;

      const levelName = ['Off', 'SOFT', 'MEDIUM', 'HARD', 'NUCLEAR'][antilinkLevel] || 'Off';

      return sock.sendMessage(chat, {
        text: `╔════════════════════════════════════╗
║      ✦ MUSTEQEEM DEFENSE SUITE ✦     ║
╚════════════════════════════════════╝

Available Commands:

.defense godmode on/off
.defense antibug on/off
.defense antilink off/soft/medium/hard/nuclear
.defense antiword add/remove/list <text>
.defense lockdown on/off

Current Status Overview:
• Godmode: ${global.defense.godmode[chat] ? 'ACTIVE ⚡' : 'Inactive'}
• AntiBug: ${global.defense.antibug[chat] ? 'ACTIVE 🛡️' : 'Inactive'}
• AntiLink: ${antilinkLevel ? 'Level ' + levelName : 'Off'}
• AntiWord: ${antiwordCount} words blocked
• Lockdown: ${global.defense.lockdown[chat] ? 'ACTIVE 🔒' : 'Inactive'}

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // ── GODMODE ──────────────────────────────────────────
    if (cmd === 'godmode') {
      const sub = (args[1] || 'status').toLowerCase();

      if (sub === 'on') {
        global.defense.godmode[chat] = true;

        // protect the bot owner + bot itself
        const botJid = sock.user?.id?.replace(/:\d+/, '') + '@s.whatsapp.net';
        if (botJid) protectedJids.add(botJid);

        return sock.sendMessage(chat, {
          text: `✦ GODMODE ACTIVATED ✦

Protected JIDs cannot be kicked or demoted (enforced in group update handler).

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      if (sub === 'off') {
        delete global.defense.godmode[chat];
        return sock.sendMessage(chat, {
          text: `Godmode deactivated.

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      const status = global.defense.godmode[chat] ? 'ACTIVE ⚡' : 'INACTIVE';
      return sock.sendMessage(chat, {
        text: `Godmode Status: ${status}

Use:
.defense godmode on
.defense godmode off

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // ── ANTIBUG ──────────────────────────────────────────
    if (cmd === 'antibug') {
      const sub = (args[1] || 'status').toLowerCase();

      if (sub === 'on') {
        global.defense.antibug[chat] = true;
        return sock.sendMessage(chat, {
          text: `╔══════ ANTIBUG WALL RAISED ══════╗
║ Deleted messages → restored     ║
║ ViewOnce → unwrapped & saved    ║
╚═════════════════════════════════╝

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      if (sub === 'off') {
        delete global.defense.antibug[chat];
        return sock.sendMessage(chat, {
          text: `Antibug protection disabled.

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      const status = global.defense.antibug[chat] ? 'ACTIVE 🛡️' : 'INACTIVE';
      return sock.sendMessage(chat, {
        text: `AntiBug Status: ${status}

Use:
.defense antibug on
.defense antibug off

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // ── ANTILINK ─────────────────────────────────────────
    if (cmd === 'antilink') {
      const level = (args[1] || 'status').toLowerCase();
      const levels = { off: 0, soft: 1, medium: 2, hard: 3, nuclear: 4 };

      if (level in levels) {
        global.defense.antilink[chat] = levels[level];
        const enabled = level !== 'off';

        return sock.sendMessage(chat, {
          text: `ANTI-LINK CONTROL
────────────────────
Level: ${level.toUpperCase()}
Status: ${enabled ? 'ENABLED ✅' : 'DISABLED ❌'}

Modes: off • soft • medium • hard • nuclear

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      const currentNum = global.defense.antilink[chat] ?? 0;
      const currentName = Object.keys(levels).find(k => levels[k] === currentNum) || 'off';

      return sock.sendMessage(chat, {
        text: `Current AntiLink Level: ${currentName.toUpperCase()}

Set with:
.defense antilink off/soft/medium/hard/nuclear

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // ── ANTIWORD ─────────────────────────────────────────
    if (cmd === 'antiword') {
      if (!global.defense.antiword[chat]) global.defense.antiword[chat] = new Set();

      const action = (args[1] || '').toLowerCase();

      if (action === 'add' && args[2]) {
        const word = args.slice(2).join(' ').toLowerCase().trim();
        global.defense.antiword[chat].add(word);
        return sock.sendMessage(chat, {
          text: `Forbidden word added:
"${word}"

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      if (action === 'remove' && args[2]) {
        const word = args.slice(2).join(' ').toLowerCase().trim();
        global.defense.antiword[chat].delete(word);
        return sock.sendMessage(chat, {
          text: `Word removed:
"${word}"

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      if (action === 'list') {
        const words = [...global.defense.antiword[chat]];
        return sock.sendMessage(chat, {
          text: words.length === 0
            ? `No forbidden words yet.

Add:
.defense antiword add <text>

> musteqeem_bot🤖`
            : `Forbidden Words (${words.length}):
${words.map(w => `• ${w}`).join('\n')}

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      return sock.sendMessage(chat, {
        text: `ANTIWORD COMMANDS:
• .defense antiword add <text>
• .defense antiword remove <text>
• .defense antiword list

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // ── LOCKDOWN ─────────────────────────────────────────
    if (cmd === 'lockdown') {
      const sub = (args[1] || 'status').toLowerCase();

      if (sub === 'on') {
        global.defense.lockdown[chat] = true;
        return sock.sendMessage(chat, {
          text: `━━━━━━━━━━━━━━━━━━━━━━━━━━━
     EMERGENCY LOCKDOWN
         ACTIVATED 🔒
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Only admins can talk (enforced in message handler).

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      if (sub === 'off') {
        delete global.defense.lockdown[chat];
        return sock.sendMessage(chat, {
          text: `Lockdown deactivated.

> musteqeem_bot🤖`
        }, { quoted: m });
      }

      const status = global.defense.lockdown[chat] ? 'ACTIVE 🔒' : 'INACTIVE';
      return sock.sendMessage(chat, {
        text: `Lockdown Status: ${status}

Use:
.defense lockdown on
.defense lockdown off

> musteqeem_bot🤖`
      }, { quoted: m });
    }

    // Unknown subcommand
    return sock.sendMessage(chat, {
      text: `Unknown defense command.

Type:
.defense menu

> musteqeem_bot🤖`
    }, { quoted: m });
  }
};

// Export protectedJids so handlers can use it
module.exports.protectedJids = protectedJids;
// ===== DEFENSE ENFORCEMENT (messages.upsert) =====

// Simple URL detector
const urlRegex = /(https?:\/\/|www\.)[^\s]+/gi;

async function getAdmins(sock, chatId) {
  try {
    const meta = await sock.groupMetadata(chatId);
    const admins = meta.participants
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id);
    return new Set(admins);
  } catch (e) {
    return new Set();
  }
}

function extractText(msg) {
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  );
}

function unwrapViewOnce(message) {
  // Supports common Baileys view-once wrappers
  const v1 = message?.viewOnceMessage?.message;
  const v2 = message?.viewOnceMessageV2?.message;
  const v2e = message?.viewOnceMessageV2Extension?.message;
  return v1 || v2 || v2e || null;
}

// Inside your existing:
// sock.ev.on("messages.upsert", async ({ messages }) => { ... })
async function defenseOnMessage(sock, m) {
  if (!m?.message) return;
  if (m.key?.remoteJid === 'status@broadcast') return;

  const chat = m.key.remoteJid;
  const isGroup = chat.endsWith('@g.us');

  // Ensure globals exist
  if (!global.defense) return; // defense.js creates it when you use the menu
  if (!global.msgStore) global.msgStore = {};
  if (!global.msgStore[chat]) global.msgStore[chat] = new Map();

  // Store message for antibug restore (store only normal messages)
  try {
    const msgId = m.key.id;
    if (msgId) global.msgStore[chat].set(msgId, m);
    // prevent memory leak
    if (global.msgStore[chat].size > 300) {
      const firstKey = global.msgStore[chat].keys().next().value;
      global.msgStore[chat].delete(firstKey);
    }
  } catch {}

  // --- ANTIBUG: restore deleted messages ---
  // Protocol revoke in Baileys is usually:
  // m.message.protocolMessage.type === 0
  const proto = m.message?.protocolMessage;
  if (proto?.type === 0 && global.defense.antibug?.[chat]) {
    const deletedKey = proto.key;
    const deletedId = deletedKey?.id;
    const cached = deletedId ? global.msgStore[chat].get(deletedId) : null;

    if (cached?.message) {
      await sock.sendMessage(chat, {
        text: `🛡️ *AntiBug Restore*\nA message was deleted, restored below:`
      }, { quoted: m });

      // Re-send the original content as-is
      await sock.sendMessage(chat, cached.message, { quoted: m });
    } else {
      await sock.sendMessage(chat, {
        text: `🛡️ *AntiBug Restore*\nDeleted message detected, but it wasn’t cached.`
      }, { quoted: m });
    }
    return;
  }

  // --- ANTIBUG: unwrap view once ---
  if (global.defense.antibug?.[chat]) {
    const unwrapped = unwrapViewOnce(m.message);
    if (unwrapped) {
      await sock.sendMessage(chat, {
        text: `🛡️ *ViewOnce Exposed*\nThis ViewOnce was unwrapped & re-sent:`
      }, { quoted: m });

      await sock.sendMessage(chat, unwrapped, { quoted: m });
      // optional: delete original view once
      // await sock.sendMessage(chat, { delete: m.key });
      return;
    }
  }

  // Below rules mostly apply to GROUPS
  if (!isGroup) return;

  const sender = m.key.participant || m.key.remoteJid;
  const admins = await getAdmins(sock, chat);
  const isAdmin = admins.has(sender);

  const text = extractText(m.message).toLowerCase();

  // --- LOCKDOWN: only admins can speak ---
  if (global.defense.lockdown?.[chat] && !isAdmin) {
    await sock.sendMessage(chat, { delete: m.key }).catch(() => {});
    await sock.sendMessage(chat, {
      text: `🔒 *LOCKDOWN ACTIVE*\nOnly admins can talk right now.`,
    }, { quoted: m });
    return;
  }

  // --- ANTIWORD: delete messages containing banned words ---
  const banned = global.defense.antiword?.[chat];
  if (banned && banned.size > 0 && !isAdmin) {
    for (const w of banned) {
      if (w && text.includes(w)) {
        await sock.sendMessage(chat, { delete: m.key }).catch(() => {});
        await sock.sendMessage(chat, {
          text: `🚫 *Forbidden Word Detected*\nMessage removed.\nWord: "${w}"`,
        }, { quoted: m });
        return;
      }
    }
  }

  // --- ANTILINK: enforce by level ---
  const level = global.defense.antilink?.[chat] ?? 0;
  if (level > 0 && !isAdmin) {
    const hasLink = urlRegex.test(text);
    if (hasLink) {
      // always delete message
      await sock.sendMessage(chat, { delete: m.key }).catch(() => {});

      if (level === 1) {
        await sock.sendMessage(chat, { text: `⚠️ Links are not allowed here (SOFT).` }, { quoted: m });
        return;
      }

      if (level === 2) {
        await sock.sendMessage(chat, { text: `🛡️ AntiLink MEDIUM: Stop posting links.` }, { quoted: m });
        return;
      }

      if (level === 3) {
        await sock.sendMessage(chat, { text: `🚫 AntiLink HARD: Removed link. Next time = kick.` }, { quoted: m });
        return;
      }

      if (level >= 4) {
        // NUCLEAR: try to remove user (requires bot admin)
        await sock.sendMessage(chat, { text: `☢️ AntiLink NUCLEAR: User removed for posting links.` }, { quoted: m });
        await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {});
        return;
      }
    }
  }
}

// ✅ Call this inside your messages.upsert loop:
// for (const m of messages) await defenseOnMessage(sock, m);
// ===== GODMODE ENFORCEMENT (group-participants.update) =====
const { protectedJids } = require('./cmds/defense'); // adjust path if needed

// sock.ev.on("group-participants.update", async (update) => { ... })
async function defenseOnGroupUpdate(sock, update) {
  try {
    const chat = update.id;
    if (!chat?.endsWith('@g.us')) return;
    if (!global.defense?.godmode?.[chat]) return;

    // If someone removed a protected user, re-add them
    if (update.action === 'remove') {
      for (const jid of update.participants || []) {
        if (protectedJids.has(jid)) {
          // attempt to re-add
          await sock.groupParticipantsUpdate(chat, [jid], 'add').catch(() => {});
          await sock.sendMessage(chat, {
            text: `⚡ GODMODE: Protected user cannot be removed.\nRe-adding: @${jid.split('@')[0]}`,
            mentions: [jid]
          });
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

// ✅ Call inside your handler:
// await defenseOnGroupUpdate(sock, update);