/**
 * GOST TRIGGER — Naija slang ping
 *
 * Command:
 *  - gost
 *
 * Reacts (random): 🌟 🫥 👻 👣 🫴
 */

const { kord, wtype } = require("../core");

const REACTIONS = ["🌟", "🫥", "👻", "👣", "🫴"];

const SLANGS = [
  "How far?",
  "How you dey now?",
  "My big man, you dey?",
  "Wetin dey sup?",
  "I dey alive.",
  "Nothing dey.",
  "No wahala.",
  "Abeg, you good?",
  "Omo, we dey.",
  "Na so we see am.",
  "You dey alright?",
  "Boss, how body?",
  "Eleyi, you don show.",
  "I hail o.",
  "Area!",
  "Oga, talk to me.",
  "We move.",
  "Soft life dey call.",
  "Chill, everything dey okay.",
  "You don land?"
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function react(m, emoji) {
  try {
    if (typeof m.react === "function") return await m.react(emoji);
  } catch {}
  try {
    // Some cores expose client.sendMessage with react payload
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(
        m.chat,
        { react: { text: emoji, key: m.key } },
        {}
      );
    }
  } catch {}
  return null;
}

kord(
  {
    cmd: "gost",
    desc: "Gost trigger (Naija slang reply)",
    fromMe: wtype,
    type: "fun",
    react: "👻",
  },
  async (m) => {
    try {
      // react first (no text before reply)
      await react(m, pick(REACTIONS));

      // then reply with slang
      const msg = pick(SLANGS);

      if (typeof m.reply === "function") return m.reply(msg);
      if (typeof m.send === "function") return m.send(msg);
      if (m?.client?.sendMessage) return m.client.sendMessage(m.chat, { text: msg }, { quoted: m });

      return null;
    } catch (e) {
      // keep it silent/premium (no noisy errors)
      return null;
    }
  }
);