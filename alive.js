const { kord } = require(process.cwd() + "/core")

kord({
  cmd: "alive",
  desc: "check if bot is online",
  fromMe: false,
  type: "general"
}
, async (m) => {
  await m.send("✅ CRYSNOVA☠️! Bot is alive and running")
}
)