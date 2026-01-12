const { kord } = require("../core");

function keys(x) {
  if (!x || typeof x !== "object") return [];
  return Object.keys(x);
}

function pickPaths(m) {
  const ext = m?.message?.extendedTextMessage;
  const ctx = ext?.contextInfo;
  const quoted = ctx?.quotedMessage;

  return {
    topKeys: keys(m),
    msgKeys: keys(m?.message),
    extKeys: keys(ext),
    ctxKeys: keys(ctx),
    quotedKeys: keys(quoted),
    quotedHas: {
      imageMessage: !!quoted?.imageMessage,
      videoMessage: !!quoted?.videoMessage,
      documentMessage: !!quoted?.documentMessage,
      stickerMessage: !!quoted?.stickerMessage,
      audioMessage: !!quoted?.audioMessage,
    },
    directHas: {
      imageMessage: !!m?.message?.imageMessage,
      videoMessage: !!m?.message?.videoMessage,
      documentMessage: !!m?.message?.documentMessage,
      stickerMessage: !!m?.message?.stickerMessage,
      audioMessage: !!m?.message?.audioMessage,
    },
    also: {
      hasQuotedProp: !!m?.quoted,
      hasReplyMessageProp: !!m?.reply_message,
      hasMsgQuoted: !!m?.msg?.quoted,
      hasBody: !!m?.body,
      hasText: !!m?.text,
    },
  };
}

kord(
  { cmd: "nurldebug", desc: "Debug reply media structure", type: "tools", react: "🧪" },
  async (m) => {
    try {
      const info = pickPaths(m);
      const out = "```" + JSON.stringify(info, null, 2) + "```";
      return m.reply(out);
    } catch (e) {
      return m.reply("❌ nurldebug failed: " + (e?.message || e));
    }
  }
);