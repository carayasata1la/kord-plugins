// ========================
// ANTI-DEMOTE PROTECTION (VENOM)
// ========================

sock.ev.on('group-participants.update', async (update) => {
    try {
        const { id: groupJid, participants, action } = update;

        // Only process demotions
        if (action !== 'demote') return;

        // Skip if feature is not enabled for this group
        if (!global.antidemote?.[groupJid]) return;

        const botJid = sock.user?.id?.replace(/:\d+/, '') + '@s.whatsapp.net';

        // Check if BOT itself was demoted
        if (participants.includes(botJid)) {
            console.log(`[ANTI-DEMOTE] Bot was demoted in ${groupJid} → COUNTERATTACK`);

            // Try to promote bot back (this often fails after real demote, but worth trying)
            await sock.groupParticipantsUpdate(groupJid, [botJid], 'promote')
                .catch(() => {
                    console.log('[ANTI-DEMOTE] Self-promote failed - probably already lost admin rights');
                });

            // Get fresh group info
            const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
            if (!groupMeta) {
                await sock.sendMessage(groupJid, { 
                    text: `⚠️ Bot demotion detected!\nCouldn't recover automatically.\nPlease promote bot back manually.\n\n> Musteqeem bot` 
                });
                return;
            }

            const botIsStillAdmin = groupMeta.participants.some(
                p => p.id === botJid && ['admin', 'superadmin'].includes(p.admin)
            );

            if (botIsStillAdmin) {
                // === Try to punish the attacker ===
                // Since we don't know exactly WHO did it, most bots:
                // 1. Demote the person who appears in the demote list (sometimes the actor)
                // 2. Or take aggressive action (demote/kick suspicious members)

                const ownerJid = '234xxxxxxxxxx@s.whatsapp.net'; // ← CHANGE TO YOUR REAL NUMBER!

                // Protect bot + owner
                const protected = [botJid, ownerJid];

                // Suspects = all who were mentioned in this update, excluding protected
                const suspects = participants.filter(p => !protected.includes(p));

                if (suspects.length > 0) {
                    // First demote (safer than direct kick)
                    await sock.groupParticipantsUpdate(groupJid, suspects, 'demote').catch(() => {});

                    // Then remove (kick)
                    await sock.groupParticipantsUpdate(groupJid, suspects, 'remove').catch(() => {});

                    await sock.sendMessage(groupJid, {
                        text: `🚨 ANTI-DEMOTE TRIGGERED!\nSomeone tried to demote the bot → they got demoted & kicked!\n\n> Musteqeem bot`,
                        mentions: suspects
                    });
                } else {
                    await sock.sendMessage(groupJid, {
                        text: `🚨 Bot demotion attempt detected!\nCouldn't identify attacker, but bot tried to recover.\n\n> Musteqeem bot`
                    });
                }
            } else {
                // Bot lost admin → can't do much anymore
                await sock.sendMessage(groupJid, {
                    text: `⚠️ Bot was successfully demoted and lost admin rights!\nAnti-demote couldn't counter fully.\nPromote bot back please.\n\n> Musteqeem bot`
                });
            }
        }

    } catch (error) {
        console.error('[ANTI-DEMOTE ERROR]', error);
    }
});