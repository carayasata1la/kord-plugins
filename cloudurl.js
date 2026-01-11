/**
 * CloudPages URL Maker v1 (cloudurl)
 * Upload replied media to GitHub repo and return Cloudflare Pages URL.
 *
 * Commands:
 *  - cloudurl | curl (reply media)            -> upload + return URL
 *  - cloudurl <filename.ext> (reply media)    -> upload with custom filename
 *  - cloudurlcfg                              -> show config
 *  - cloudurlhelp                             -> help
 *
 * Setvars:
 *  CLOUDURL_TOKEN   = GitHub token (required)
 *  CLOUDURL_OWNER   = repo owner (required)
 *  CLOUDURL_REPO    = repo name (required)
 *  CLOUDURL_BRANCH  = branch (default: main)
 *  CLOUDURL_BASE    = https://xxxx.pages.dev (required)
 *  CLOUDURL_DIR     = folder in repo (default: media)
 */

const https = require("https");
const { kord, wtype, config, prefix } = require("../core");

/* ---------------- SAFE CORE ---------------- */
function getCfgAny() {
  try { if (typeof config === "function") return config() || {}; } catch {}
  try { return config || {}; } catch { return {}; }
}
function getVar(name, fallback = "") {
  const env = process.env?.[name];
  if (env !== undefined && env !== null) {
    const s = String(env).trim();
    if (s) return s;
  }
  const cfg = getCfgAny();
  const v = cfg?.[name];
  if (v !== undefined && v !== null) {
    const s = String(v).trim();
    if (s) return s;
  }
  return fallback;
}
function SAFE_PREFIX() {
  const envP = process.env.PREFIX;
  if (envP && String(envP).trim()) return String(envP).trim();
  if (typeof prefix === "string" && prefix.trim()) return prefix.trim();
  return ".";
}
function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}
function isAllowed(m) {
  if (m?.fromMe) return true;
  if (m?.isOwner) return true;
  if (m?.isSudo) return true;
  if (m?.isMod) return true;

  const cfg = getCfgAny();
  const sudoRaw = cfg?.SUDO || cfg?.SUDO_USERS || cfg?.SUDOS;
  const sender = getSenderId(m);
  if (sudoRaw && sender) {
    const list = Array.isArray(sudoRaw)
      ? sudoRaw
      : String(sudoRaw).split(",").map((x) => x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

/* ---------------- HELPERS ---------------- */
function cleanName(name) {
  return String(name || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
}
function guessExt(mime = "") {
  const x = String(mime).toLowerCase();
  if (x.includes("image/jpeg")) return "jpg";
  if (x.includes("image/png")) return "png";
  if (x.includes("image/webp")) return "webp";
  if (x.includes("image/gif")) return "gif";
  if (x.includes("video/mp4")) return "mp4";
  if (x.includes("video/")) return "mp4";
  if (x.includes("audio/mpeg")) return "mp3";
  if (x.includes("audio/ogg")) return "ogg";
  if (x.includes("audio/wav")) return "wav";
  if (x.includes("application/pdf")) return "pdf";
  return "bin";
}
function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/g, "");
  const pp = String(p || "").replace(/^\/+/g, "");
  return `${b}/${pp}`;
}
function ghReq({ method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;

    const req = https.request(
      {
        method,
        hostname: "api.github.com",
        path,
        headers: {
          "User-Agent": "KORD-CloudURL",
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, json, raw });
          const msg = (json && (json.message || json.error)) ? (json.message || json.error) : raw || `HTTP ${res.statusCode}`;
          return reject(new Error(`GitHub API ${res.statusCode}: ${msg}`));
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
async function safeReact(m, emoji) {
  try { if (typeof m.react === "function") return await m.react(emoji); } catch {}
  try { if (typeof m.reaction === "function") return await m.reaction(emoji); } catch {}
  try { if (typeof m.sendReaction === "function") return await m.sendReaction(emoji); } catch {}
  return null;
}
async function downloadAnyMedia(m) {
  // Best-effort across different KORD builds
  try {
    if (m?.quoted?.download) return await m.quoted.download();
  } catch {}
  try {
    if (m?.download) return await m.download();
  } catch {}
  try {
    if (m?.quoted && m?.client?.downloadMediaMessage) return await m.client.downloadMediaMessage(m.quoted);
  } catch {}
  try {
    if (m?.message && m?.client?.downloadMediaMessage) return await m.client.downloadMediaMessage(m.message);
  } catch {}
  return null;
}

function detectMime(m) {
  try {
    const q = m?.quoted?.message || m?.message || {};
    const keys = Object.keys(q || {});
    const k = keys[0];
    const node = q?.[k] || {};
    return node?.mimetype || node?.mimetype?.toString?.() || "";
  } catch {
    return "";
  }
}

async function uploadToGitHub({ token, owner, repo, branch, dir, filename, buffer }) {
  const b64 = buffer.toString("base64");
  const cleanDir = String(dir || "media").replace(/^\/+|\/+$/g, "");
  const cleanFile = cleanName(filename);
  const fullPath = cleanDir ? `${cleanDir}/${cleanFile}` : cleanFile;

  // Check if file exists to get SHA
  let sha = null;
  try {
    const r = await ghReq({
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(fullPath)}?ref=${encodeURIComponent(branch)}`,
      token,
    });
    sha = r?.json?.sha || null;
  } catch (e) {
    // If not found, ignore; anything else will be caught later on PUT
    if (!String(e.message || "").includes("404")) {}
  }

  const msg = `cloudurl: upload ${cleanFile}`;
  const put = await ghReq({
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(fullPath)}`,
    token,
    body: {
      message: msg,
      content: b64,
      branch,
      ...(sha ? { sha } : {}),
    },
  });

  return { path: fullPath, sha: put?.json?.content?.sha || sha };
}

function cfgNow() {
  return {
    token: getVar("CLOUDURL_TOKEN", ""),
    owner: getVar("CLOUDURL_OWNER", ""),
    repo: getVar("CLOUDURL_REPO", ""),
    branch: getVar("CLOUDURL_BRANCH", "main"),
    base: getVar("CLOUDURL_BASE", ""),
    dir: getVar("CLOUDURL_DIR", "media"),
  };
}

function cfgOk(c) {
  if (!c.token) return "Missing CLOUDURL_TOKEN";
  if (!c.owner) return "Missing CLOUDURL_OWNER";
  if (!c.repo) return "Missing CLOUDURL_REPO";
  if (!c.base) return "Missing CLOUDURL_BASE";
  return "";
}

kord(
  { cmd: "cloudurl|curl", desc: "Upload media -> Cloudflare Pages URL", fromMe: wtype, type: "tools", react: "☁️" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      const c = cfgNow();
      const bad = cfgOk(c);
      const pfx = SAFE_PREFIX();
      if (bad) {
        await safeReact(m, "⚠️");
        return m.reply
          ? m.reply(
              `⚠️ ${bad}\n\nSetvars:\n` +
              `${pfx}setvar CLOUDURL_TOKEN=YOUR_GITHUB_TOKEN\n` +
              `${pfx}setvar CLOUDURL_OWNER=CRYSNOVA\n` +
              `${pfx}setvar CLOUDURL_REPO=kord-plugins\n` +
              `${pfx}setvar CLOUDURL_BRANCH=main\n` +
              `${pfx}setvar CLOUDURL_BASE=https://kord-plugins.pages.dev\n` +
              `${pfx}setvar CLOUDURL_DIR=media`
            )
          : null;
      }

      const buf = await downloadAnyMedia(m);
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        await safeReact(m, "❌");
        return m.reply ? m.reply("❌ Reply an image/video/audio/document, then type: cloudurl") : null;
      }

      // Size safety: 20MB (keep it safe for WhatsApp + GitHub API)
      const max = 20 * 1024 * 1024;
      if (buf.length > max) {
        await safeReact(m, "⚠️");
        return m.reply ? m.reply(`⚠️ File too big: ${(buf.length / 1024 / 1024).toFixed(2)}MB\nMax: 20MB`) : null;
      }

      const rawName = String(text || "").trim();
      const mime = detectMime(m);
      const ext = guessExt(mime);
      const auto = `kord_${Date.now()}.${ext}`;
      const filename = cleanName(rawName || auto) || auto;

      await safeReact(m, "⬆️");
      if (m.reply) await m.reply("☁️ Uploading to GitHub...");

      const up = await uploadToGitHub({
        token: c.token,
        owner: c.owner,
        repo: c.repo,
        branch: c.branch,
        dir: c.dir,
        filename,
        buffer: buf,
      });

      // Pages URL
      const url = joinUrl(c.base, up.path);

      await safeReact(m, "✅");
      return m.reply ? m.reply(`✅ Uploaded!\n\n🌐 URL:\n${url}`) : null;

    } catch (e) {
      await safeReact(m, "❌");
      return m.reply ? m.reply("❌ cloudurl failed: " + (e?.message || e)) : null;
    }
  }
);

kord(
  { cmd: "cloudurlcfg", desc: "Show CloudURL config", fromMe: wtype, type: "tools", react: "⚙️" },
  async (m) => {
    if (!isAllowed(m)) return;
    const c = cfgNow();
    const masked = c.token ? (c.token.slice(0, 6) + "..." + c.token.slice(-4)) : "NOT SET";
    return m.reply
      ? m.reply(
          `☁️ CloudURL Config\n\n` +
          `OWNER  : ${c.owner || "NOT SET"}\n` +
          `REPO   : ${c.repo || "NOT SET"}\n` +
          `BRANCH : ${c.branch || "main"}\n` +
          `DIR    : ${c.dir || "media"}\n` +
          `BASE   : ${c.base || "NOT SET"}\n` +
          `TOKEN  : ${masked}\n`
        )
      : null;
  }
);

kord(
  { cmd: "cloudurlhelp", desc: "CloudURL help", fromMe: wtype, type: "tools", react: "📌" },
  async (m) => {
    if (!isAllowed(m)) return;
    const pfx = SAFE_PREFIX();
    return m.reply
      ? m.reply(
          `☁️ CloudPages URL Maker v1\n\n` +
          `Usage:\n` +
          `• Reply media + ${pfx}cloudurl\n` +
          `• Reply media + ${pfx}cloudurl myvideo.mp4\n\n` +
          `Setup:\n` +
          `${pfx}setvar CLOUDURL_TOKEN=...\n` +
          `${pfx}setvar CLOUDURL_OWNER=CRYSNOVA\n` +
          `${pfx}setvar CLOUDURL_REPO=kord-plugins\n` +
          `${pfx}setvar CLOUDURL_BASE=https://kord-plugins.pages.dev\n` +
          `${pfx}setvar CLOUDURL_DIR=media\n\n` +
          `Check:\n• ${pfx}cloudurlcfg`
        )
      : null;
  }
);