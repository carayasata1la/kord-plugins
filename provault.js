/**
 * ProVault - Premium Secure Snippet Vault (TEXT ONLY)
 *
 * Commands:
 *  - vaultpass <newpass>         Set vault password (owner/sudo only)
 *  - vault login <pass>          Unlock vault (3 minutes)
 *  - vault lock                  Lock vault immediately
 *  - vault save <name>           Reply to a message (text/code) and save it
 *  - vault get <name>            Get saved snippet (auto split)
 *  - vault list                  List saved snippets
 *  - vault del <name>            Delete snippet
 */

const fs = require("fs");
const path = require("path");
const { kord } = require("../core");

const DIR = path.join("/home/container", "cmds", ".provault");
const DB = path.join(DIR, "db.json");

const UNLOCK_MS = 3 * 60 * 1000; // 3 min
const CHUNK = 3200; // safe whatsapp chunk

function ensureDB() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ pass: "", vault: {}, sessions: {} }, null, 2));
}

function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8"));
  } catch {
    return { pass: "", vault: {}, sessions: {} };
  }
}

function writeDB(d) {
  ensureDB();
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));
}

function senderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}

function isStaff(m) {
  if (m?.fromMe) return true;
  if (m?.isOwner) return true;
  if (m?.isCreator) return true;
  if (m?.isSudo) return true;
  return false;
}

function isUnlocked(m) {
  const d = readDB();
  const sid = senderId(m);
  const exp = d.sessions?.[sid] || 0;
  return Date.now() < exp;
}

function requireUnlocked(m) {
  if (!isStaff(m)) return false;
  const d = readDB();
  if (!d.pass) {
    m.reply("🔒 Vault password not set.\nUse: vaultpass <newpass>");
    return false;
  }
  if (!isUnlocked(m)) {
    m.reply("🔒 Vault locked.\nLogin: vault login <pass>");
    return false;
  }
  return true;
}

async function getTextFromReply(m) {
  // Try multiple KORD message shapes
  let txt =
    m?.quoted?.text ||
    m?.quoted?.body ||
    m?.quoted?.message?.conversation ||
    m?.quoted?.message?.extendedTextMessage?.text ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text ||
    m?.body ||
    "";

  txt = String(txt || "").trim();
  return txt;
}

async function sendLong(m, text) {
  const s = String(text || "");
  if (!s.trim()) return m.reply("❌ Empty snippet.");
  if (s.length <= CHUNK) return m.reply("```" + s + "```");

  let i = 0, part = 1;
  while (i < s.length) {
    const piece = s.slice(i, i + CHUNK);
    await m.reply(`🧩 Part ${part}\n\`\`\`\n${piece}\n\`\`\``);
    i += CHUNK;
    part++;
  }
}

/* ---------------- PASSWORD ---------------- */

kord(
  { cmd: "vaultpass", desc: "Set ProVault password", type: "owner", react: "🔐" },
  async (m, arg) => {
    try {
      if (!isStaff(m)) return;
      const pass = String(arg || "").trim();
      if (!pass || pass.length < 3) return m.reply("❌ Use: vaultpass <newpass> (min 3 chars)");

      const d = readDB();
      d.pass = pass;
      writeDB(d);
      return m.reply("✅ ProVault password set.");
    } catch {
      return m.reply("❌ Failed to set password.");
    }
  }
);

/* ---------------- LOGIN / LOCK ---------------- */

kord(
  { cmd: "vault", desc: "ProVault", type: "tools", react: "🗃️" },
  async (m, arg) => {
    try {
      const input = String(arg || "").trim();
      const [sub, ...rest] = input.split(/\s+/);
      const d = readDB();
      const sid = senderId(m);

      if (!isStaff(m)) return;

      if (!sub) {
        return m.reply(
          "🗃️ *ProVault*\n" +
            "• vault login <pass>\n" +
            "• vault lock\n" +
            "• vault save <name> (reply to text)\n" +
            "• vault get <name>\n" +
            "• vault list\n" +
            "• vault del <name>"
        );
      }

      if (sub === "login") {
        const passTry = rest.join(" ").trim();
        if (!d.pass) return m.reply("🔒 Password not set. Use: vaultpass <newpass>");
        if (!passTry) return m.reply("❌ Use: vault login <pass>");
        if (passTry !== d.pass) return m.reply("❌ Wrong password.");

        d.sessions[sid] = Date.now() + UNLOCK_MS;
        writeDB(d);
        return m.reply("✅ Vault unlocked (3 minutes).");
      }

      if (sub === "lock") {
        d.sessions[sid] = 0;
        writeDB(d);
        return m.reply("✅ Vault locked.");
      }

      // Everything below requires unlock
      if (!d.pass) return m.reply("🔒 Password not set. Use: vaultpass <newpass>");
      if (!isUnlocked(m)) return m.reply("🔒 Vault locked.\nLogin: vault login <pass>");

      if (sub === "save") {
        const name = rest.join(" ").trim();
        if (!name) return m.reply("❌ Use: vault save <name> (reply to a text/code message)");
        const txt = await getTextFromReply(m);
        if (!txt) return m.reply("❌ Reply to a text/code message to save.");

        d.vault[name] = { text: txt, at: Date.now() };
        writeDB(d);
        return m.reply(`✅ Saved: *${name}*`);
      }

      if (sub === "get") {
        const name = rest.join(" ").trim();
        if (!name) return m.reply("❌ Use: vault get <name>");
        const item = d.vault[name];
        if (!item) return m.reply("❌ Not found.");
        return sendLong(m, item.text);
      }

      if (sub === "list") {
        const names = Object.keys(d.vault || {});
        if (!names.length) return m.reply("📭 Vault empty.");
        return m.reply("🗂️ *Saved Snippets*\n" + names.map((x, i) => `${i + 1}. ${x}`).join("\n"));
      }

      if (sub === "del") {
        const name = rest.join(" ").trim();
        if (!name) return m.reply("❌ Use: vault del <name>");
        if (!d.vault[name]) return m.reply("❌ Not found.");
        delete d.vault[name];
        writeDB(d);
        return m.reply(`✅ Deleted: *${name}*`);
      }

      return m.reply("❌ Unknown subcommand. Send: vault");
    } catch {
      return m.reply("❌ ProVault error.");
    }
  }
);