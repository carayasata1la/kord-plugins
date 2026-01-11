// novaping.js
// Command: .novaping
// Replies with latency + uptime (simple ping-style command)

module.exports = {
  name: "novaping",
  alias: ["nping", "novap"],
  desc: "Ping command (Nova version)",
  category: "tools",

  // Most KORD-style bots call this with something like (sock, m, args, text)
  // If your handler uses different params, just adapt the names.
  async run(sock, m, args) {
    const start = Date.now();

    // Send quick "Pinging..." first (optional)
    const sent = await sock.sendMessage(m.chat, { text: "🏓 Pinging..." }, { quoted: m });

    const ms = Date.now() - start;

    // uptime
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const min = Math.floor((uptimeSec % 3600) / 60);
    const sec = uptimeSec % 60;

    const msg =
      `✅ *NovaPing*\n` +
      `• Latency: *${ms}ms*\n` +
      `• Uptime: *${h}h ${min}m ${sec}s*`;

    // Edit message if your bot supports editing; otherwise just send new message.
    // Many WhatsApp libs don't support edit reliably, so we send another message:
    await sock.sendMessage(m.chat, { text: msg }, { quoted: m });
  },
};