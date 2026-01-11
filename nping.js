// novaping.js
// Triggers on: .novaping, novaping, .nping, nping, .novap, novap

module.exports = {
  name: "novaping",
  alias: ["nping", "novap"],
  desc: "Ping command (Nova version)",
  category: "tools",

  async run(sock, m) {
    const text =
      (m?.text || m?.message?.conversation || m?.message?.extendedTextMessage?.text || "")
        .trim()
        .toLowerCase();

    // Accept with or without prefix
    const ok =
      text === ".novaping" || text === "novaping" ||
      text === ".nping" || text === "nping" ||
      text === ".novap" || text === "novap";

    if (!ok) return;

    const start = Date.now();
    await sock.sendMessage(m.chat, { text: "🏓 Pinging..." }, { quoted: m });
    const ms = Date.now() - start;

    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const min = Math.floor((uptimeSec % 3600) / 60);
    const sec = uptimeSec % 60;

    await sock.sendMessage(
      m.chat,
      { text: `✅ *NovaPing*\n• Latency: *${ms}ms*\n• Uptime: *${h}h ${min}m ${sec}s*` },
      { quoted: m }
    );
  },
};