const { kord } = require(process.cwd() + "/core");

function parseTime(time) {
  if (!time) return null;
  const match = time.match(/^(\d+)(s|m)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  return match[2] === "s" ? value * 1000 : value * 60000;
}

kord(
  {
    cmd: "vd",
    desc: "Private disappearing message (owner only)",
    fromMe: true, // 🔒 PRIVATE
    type: "tools"
  },
  async (m, text) => {
    if (!text) {
      return m.send("❌ Usage: .vd <message> | .vd 10s <message>");
    }

    let delay = 10000; // default 10s
    let message = text;

    const parts = text.split(" ");
    const time = parseTime(parts[0]);

    if (time) {
      delay = time;
      message = parts.slice(1).join(" ");
    }

    if (!message) return m.send("❌ Message cannot be empty");

    const sent = await m.send(`🫥 ${message}`);

    setTimeout(async () => {
      try {
        await m.client.sendMessage(m.chat, { delete: sent.key });
      } catch (e) {
        console.log("Delete failed:", e);
      }
    }, delay);
  }
);