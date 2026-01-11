/**
 * JustLetterDeploy LITE
 * URL -> RAW CODE -> SAFE TEXT PARTS
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const { kord, wtype, config, prefix } = require("../core");

/* ---------------- CONFIG ---------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".jldlite");
const PASS_FILE = path.join(DATA_DIR, "pass.json");

const MAX_BYTES = 450 * 1024; // 450KB
const MAX_PARTS = 3;

/* ---------------- UTIL ---------------- */
function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }));
}

function getPass() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(PASS_FILE)).pass || "";
  } catch {
    return "";
  }
}

function setPass(p) {
  ensure();
  fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: String(p).trim() }));
}

function SAFE_PREFIX() {
  return (process.env.PREFIX || prefix || ".").trim();
}

function isAllowed(m) {
  if (m?.fromMe || m?.isOwner || m?.isMod || m?.isSudo) return true;
  return false;
}

function isValidUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/* ---------------- FETCH ---------------- */
function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (!isValidUrl(url)) return reject(new Error("Invalid URL"));

    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        return resolve(fetchText(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));

      let data = "";
      res.on("data", (c) => {
        data += c;
        if (data.length > MAX_BYTES) {
          res.destroy();
          reject(new Error("Code too large"));
        }
      });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

/* -------- SAFE SPLITTER (BRACE AWARE) -------- */
function splitSafe(code) {
  const parts = [];
  let buf = "";
  let depth = 0;
  let str = null;

  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const p = code[i - 1];

    if (str) {
      if (c === str && p !== "\\") str = null;
    } else {
      if (c === "'" || c === '"' || c === "`") str = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
    }

    buf += c;

    if (
      buf.length > Math.floor(code.length / MAX_PARTS) &&
      depth === 0 &&
      !str &&
      parts.length < MAX_PARTS - 1
    ) {
      parts.push(buf);
      buf = "";
    }
  }

  if (buf) parts.push(buf);
  return parts;
}

/* ---------------- COMMANDS ---------------- */
kord(
  { cmd: "jldpass", fromMe: wtype, type: "tools" },
  async (m, text) => {
    if (!isAllowed(m)) return;
    const p = String(text || "").trim();
    if (!p) return m.reply("Usage: jldpass <password>");
    setPass(p);
    return m.reply("✅ JLD password set.");
  }
);

kord(
  { cmd: "jld", fromMe: wtype, type: "tools" },
  async (m, text) => {
    if (!isAllowed(m)) return;

    const args = String(text || "").trim().split(/\s+/);
    if (args.length < 2) {
      return m.reply(`Usage: ${SAFE_PREFIX()}jld <password> <url>`);
    }

    const pass = args.shift();
    const url = args.join(" ");

    if (pass !== getPass()) return m.reply("❌ JLD: invalid password");

    try {
      const code = await fetchText(url);
      const parts = splitSafe(code);

      for (let i = 0; i < parts.length; i++) {
        await m.reply(
          `[JLD PART ${i + 1} / ${parts.length}]\n\n${parts[i]}`
        );
      }
    } catch (e) {
      return m.reply("❌ JLD failed: " + e.message);
    }
  }
);