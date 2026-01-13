/**
 * Maker God 2.0 — Beginner-friendly plugin generator (SAFE)
 * File: /home/container/cmds/maker.js
 *
 * Commands (simple):
 *  - maker start
 *  - maker idea <plain english>
 *  - maker cmd <name>
 *  - maker type <tools|core|image|fun|...>
 *  - maker done
 *
 * Advanced:
 *  - maker desc <...>
 *  - maker react <emoji>
 *  - maker fromme <true|false>
 *  - maker deps <a,b,c>
 *  - maker template <ping|text|api_get|api_post|png_stub>
 *  - maker preview
 *  - maker cancel
 *
 * Safety:
 *  - Blocks dangerous keywords in user-injected code.
 *  - Syntax-checks generated plugin before saving (vm.Script).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { kord, wtype } = require("../core");

const CMD_DIR = "/home/container/cmds";
const SESS = new Map(); // per chat+sender

function skey(m) {
  const chat = m?.chat || m?.key?.remoteJid || "chat";
  const sender = m?.sender || m?.key?.participant || "sender";
  return `${chat}::${sender}`;
}

function cleanCmd(s) {
  s = String(s || "").trim().toLowerCase();
  s = s.replace(/[^a-z0-9_]/g, "");
  return s;
}

function pickEmoji(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("image")) return "🖼️";
  if (t.includes("core")) return "🧠";
  if (t.includes("fun")) return "🎭";
  if (t.includes("tools")) return "🛠️";
  return "✨";
}

function safeDefaults(sess) {
  if (!sess.desc) sess.desc = sess.idea ? String(sess.idea).slice(0, 40) : "New plugin";
  if (!sess.type) sess.type = "tools";
  if (!sess.react) sess.react = pickEmoji(sess.type);
  if (sess.fromMe === undefined) sess.fromMe = false; // beginner-friendly default
  if (!sess.template) sess.template = autoTemplate(sess.idea);
  if (!sess.deps) sess.deps = autoDeps(sess.template);
}

function autoTemplate(idea = "") {
  const x = String(idea).toLowerCase();
  if (x.includes("ping")) return "ping";
  if (x.includes("api") || x.includes("fetch") || x.includes("http")) return "api_get";
  if (x.includes("png") || x.includes("convert") || x.includes("image to png")) return "png_stub";
  if (x.includes("reply") || x.includes("text")) return "text";
  return "text";
}

function autoDeps(template) {
  if (template === "png_stub") return "sharp";
  if (template === "api_get" || template === "api_post") return "axios";
  return "";
}

// Very important: block obvious dangerous stuff if you ever add "custom logic" mode later
function looksDangerous(code) {
  const bad = [
    "child_process",
    "exec(",
    "spawn(",
    "fork(",
    "eval(",
    "Function(",
    "process.exit",
    "rm -rf",
    "fs.rmdir",
    "fs.unlink",
    "fs.writeFileSync('/",
    "fs.writeFileSync(\"/",
  ];
  const s = String(code || "").toLowerCase();
  return bad.some((k) => s.includes(k));
}

// Templates: safe, pro, always try/catch, minimal assumptions
function renderTemplate(sess) {
  const cmd = sess.cmd;
  const desc = sess.desc;
  const type = sess.type;
  const react = sess.react;
  const fromMe = sess.fromMe ? "wtype" : "false";
  const deps = sess.deps ? `// deps: ${sess.deps}\n` : "";

  let body = "";

  if (sess.template === "ping") {
    body = `
      const ms = Date.now();
      const msg = "✅ Pong! " + (Date.now() - ms) + "ms";
      return m.reply(msg);
    `.trim();
  } else if (sess.template === "text") {
    body = `
      const text = String(arg || "").trim();
      if (!text) return m.reply("❌ Use: ${cmd} <text>");
      return m.reply("✅ " + text);
    `.trim();
  } else if (sess.template === "api_get") {
    body = `
      const axios = require("axios");
      const q = String(arg || "").trim();
      if (!q) return m.reply("❌ Use: ${cmd} <query>");
      // Example endpoint — replace with your own API
      const url = "https://httpbin.org/get?query=" + encodeURIComponent(q);
      const r = await axios.get(url, { timeout: 30000 });
      return m.reply("✅ API OK\\n" + JSON.stringify(r.data, null, 2).slice(0, 3500));
    `.trim();
  } else if (sess.template === "api_post") {
    body = `
      const axios = require("axios");
      const text = String(arg || "").trim();
      if (!text) return m.reply("❌ Use: ${cmd} <text>");
      const r = await axios.post("https://httpbin.org/post", { text }, { timeout: 30000 });
      return m.reply("✅ POST OK\\n" + JSON.stringify(r.data, null, 2).slice(0, 3500));
    `.trim();
  } else if (sess.template === "png_stub") {
    body = `
      const sharp = require("sharp");

      // Must reply to an image for conversion
      const quoted = m?.quoted || m?.msg?.quoted;
      if (!quoted) return m.reply("❌ Reply to an image.");

      let media = null;
      try { if (typeof m.download === "function") media = await m.download(); } catch {}
      try { if (!media && quoted?.download) media = await quoted.download(); } catch {}

      if (!media) return m.reply("❌ Failed to download image.");
      const png = await sharp(media).png().toBuffer();

      if (m?.client?.sendMessage) {
        return await m.client.sendMessage(m.chat, { image: png, caption: "✅ PNG ready" }, { quoted: m });
      }
      return m.reply("✅ PNG ready (sendMessage not available).");
    `.trim();
  } else {
    body = `return m.reply("✅ ${cmd} ready");`;
  }

  const code = `
${deps}const { kord, wtype } = require("../core");

kord(
  { cmd: "${cmd}", desc: "${escapeStr(desc)}", fromMe: ${fromMe}, type: "${escapeStr(type)}", react: "${escapeStr(react)}" },
  async (m, arg) => {
    try {
      ${body}
    } catch (e) {
      return m.reply("❌ ${cmd} error: " + (e?.message || e));
    }
  }
);
`.trim() + "\n";

  return code;
}

function escapeStr(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/"/g, '\\"');
}

function syntaxCheck(jsCode) {
  // Parse only; does not run code
  new vm.Script(jsCode, { filename: "plugin.js" });
  return true;
}

function helpText(sess) {
  safeDefaults(sess);
  return (
    "🧩 *Maker God 2.0*\n" +
    "Send these (beginner mode):\n" +
    "• maker idea <what you want>\n" +
    "• maker cmd <name>\n" +
    "• maker type <tools|core|image|fun>\n" +
    "• maker done\n\n" +
    "Optional:\n" +
    "• maker desc <...>\n" +
    "• maker react <emoji>\n" +
    "• maker fromme <true|false>\n" +
    "• maker deps <a,b>\n" +
    "• maker template <ping|text|api_get|api_post|png_stub>\n\n" +
    `Current:\n` +
    `• cmd: ${sess.cmd || "—"}\n` +
    `• desc: ${sess.desc || "—"}\n` +
    `• type: ${sess.type || "—"}\n` +
    `• react: ${sess.react || "—"}\n` +
    `• fromMe: ${sess.fromMe === undefined ? "—" : String(sess.fromMe)}\n` +
    `• deps: ${sess.deps || "—"}\n` +
    `• template: ${sess.template || "—"}\n`
  );
}

kord(
  { cmd: "maker", desc: "Maker God 2.0 (plugin generator)", fromMe: wtype, type: "tools", react: "🧩" },
  async (m, arg) => {
    const k = skey(m);
    const txt = String(arg || "").trim();

    if (!txt || txt === "help") {
      const sess = SESS.get(k) || {};
      return m.reply(helpText(sess));
    }

    const [sub, ...rest] = txt.split(/\s+/);
    const val = rest.join(" ").trim();

    // start
    if (sub === "start") {
      SESS.set(k, { started: Date.now() });
      return m.reply(helpText(SESS.get(k)));
    }

    // cancel
    if (sub === "cancel") {
      SESS.delete(k);
      return m.reply("✅ Maker session cleared.");
    }

    const sess = SESS.get(k);
    if (!sess) return m.reply("❌ Start first: maker start");

    if (sub === "idea") sess.idea = val;
    else if (sub === "cmd") sess.cmd = cleanCmd(val);
    else if (sub === "desc") sess.desc = val;
    else if (sub === "type") sess.type = val || "tools";
    else if (sub === "react") sess.react = val || "✨";
    else if (sub === "fromme") sess.fromMe = (val === "true" || val === "1" || val === "yes");
    else if (sub === "deps") sess.deps = val.replace(/\s+/g, "");
    else if (sub === "template") sess.template = val;
    else if (sub === "preview") {
      safeDefaults(sess);
      if (!sess.cmd) return m.reply("❌ Set cmd first: maker cmd <name>");
      const code = renderTemplate(sess);
      return m.reply("🧾 *Preview*\n\n```js\n" + code.slice(0, 3800) + "\n```");
    }
    else if (sub === "done" || sub === "save") {
      safeDefaults(sess);
      if (!sess.cmd) return m.reply("❌ Missing: cmd. Use: maker cmd <name>");

      const outFile = path.join(CMD_DIR, `${sess.cmd}.js`);
      const code = renderTemplate(sess);

      if (looksDangerous(code)) {
        return m.reply("❌ Blocked: generated code contains dangerous patterns.");
      }

      try {
        syntaxCheck(code);
      } catch (e) {
        return m.reply("❌ Syntax check failed:\n" + (e?.message || e));
      }

      fs.writeFileSync(outFile, code, "utf8");

      const depLine = sess.deps
        ? `\n📦 Install deps:\n\`npm i ${sess.deps.split(",").filter(Boolean).join(" ")}\``
        : "";

      return m.reply(
        `✅ Plugin saved: /cmds/${sess.cmd}.js\n` +
        `⚙️ Command: ${sess.cmd}\n` +
        `🧩 Template: ${sess.template}\n` +
        depLine +
        `\n\nRestart your bot to load it.`
      );
    }
    else {
      return m.reply("❌ Unknown maker subcommand. Send: maker help");
    }

    SESS.set(k, sess);
    return m.reply(helpText(sess));
  }
);