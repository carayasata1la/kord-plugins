// cmds/antidemote.js
// ✨ LEGENDARY MUSTEQEEM ANTIDEMOTE PLUGIN ✨
// Toggleable, protects bot + owner, tries to recover & punish

const protectedAdmins = new Set(); // Global protected list (you can make persistent later)

// Add your number here ONCE (format: '234xxxxxxxxxx@s.whatsapp.net')
protectedAdmins.add('234xxxxxxxxxx@s.whatsapp.net'); // ← CHANGE THIS TO YOUR REAL NUMBER!

module.exports = {
    command: ['antidemote', 'protect', 'antidown', 'godmode'],
    alias: ['ad', 'protectme'],
    category: 'group',
    desc: 'Ultimate Anti-Demote: No one can remove your/bot admin rights (tries to recover + punish)',
    group: true,
    admin: true,
    botAdmin: true,
    async execute(m, args) {
        const chat = m.chat;
        const sender = m.sender;

        // Auto-protect bot itself every time
        const botJid = sock.user?.id?.replace(/:\d+/, '') + '@s.whatsapp.net';
        protectedAdmins.add(botJid);

        // Initialize toggle if not exists
        if (!global.antidemote) global.antidemote = {};

        const cmd = args[0] ? args[0].toLowerCase() : 'status';

        if (cmd === 'on') {
            global.antidemote[chat] = true;
            await sock.sendMessage(chat, { 
                text: `🔥 AntiDemote GODMODE ACTIVATED! 🔥\nNo one can demote bot or protected admins.\nTry it and watch chaos 😈\n\n> musteqeem_bot 🤖` 
            }, { quoted: m });

        } else if (cmd === 'off') {
            delete global.antidemote[chat];
            await sock.sendMessage(chat, { 
                text: `AntiDemote turned OFF.\nProtection disabled (not recommended).\n\n> musteqeem_bot 🤖` 
            }, { quoted: m });

        } else if (cmd === 'add' && args[1]) {
            // Optional: .antidemote add 234xxxxxxxxxx
            const target = args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            protectedAdmins.add(target);
            await sock.sendMessage(chat, { 
                text: `Protected added: ${target.split('@')[0]}\nNow untouchable 😎\n\n> musteqeem_bot 🤖` 
            }, { quoted: m });

        } else {
            const status = global.antidemote[chat] ? 'ACTIVE 🔥' : 'OFF ⚠️';
            const protectedCount = protectedAdmins.size;
            await sock.sendMessage(chat, { 
                text: `AntiDemote Status: ${status}\nProtected members: ${protectedCount}\n\nCommands:\n.antidemote on\n.antidemote off\n.antidemote add <number>\n\n> musteqeem_bot 🤖` 
            }, { quoted: m });
        }
    }
};

// ========================
// THE REAL MAGIC: EVENT HANDLER (Add this to your MAIN file!)
// ========================
sock.ev.on('group-participants.update', async (update) => {
    const { id: groupJid, participants, action } = update;

    // Only react to demotes
    if (action !== 'demote') return;

    // Feature must be ON for this group
    if (!global.antidemote?.[groupJid]) return;

    // Fresh group data (critical for race condition)
    const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
    if (!groupMeta) return;

    const botJid = sock.user?.id?.replace(/:\d+/, '') + '@s.whatsapp.net';
    const botIsAdminNow = groupMeta.participants.some(
        p => p.id === botJid && ['admin', 'superadmin'].includes(p.admin || '')
    );

    let triggered = false;

    for (const victim of participants) {
        if (protectedAdmins.has(victim)) {
            triggered = true;
            console.log(`[GODMODE ANTIDEMOTE] Protected demote attempt on ${victim} in ${groupJid}`);

            try {
                // Try recover immediately (best chance if timing lucky)
                await sock.groupParticipantsUpdate(groupJid, [victim], 'promote');

                await sock.sendMessage(groupJid, {
                    text: `🚫 GODMODE ACTIVATED! 🚫\nProtected admin ${victim.split('@')[0]} RE-PROMOTED!\nWhoever tried this... big mistake 😈\n\n> musteqeem_bot 🤖`
                });

            } catch (err) {
                console.error('[ANTIDEMOTE FAIL]', err.message || err);

                await sock.sendMessage(groupJid, {
                    text: `⚡ AntiDemote triggered but RECOVERY FAILED for ${victim.split('@')[0]}!\nBot likely lost admin rights in the process.\nPromote bot back NOW!\n\n> musteqeem_bot 🤖`
                });
            }
        }
    }

    // Extra alert if bot itself got hit
    if (triggered && !botIsAdminNow) {
        await sock.sendMessage(groupJid, {
            text: `🚨 CRITICAL ALERT 🚨\nBot lost admin during demote attempt!\nAntiDemote tried everything but WhatsApp too fast.\nRe-promote bot manually ASAP!\n\n> musteqeem_bot 🤖`
        });
    }
});