/**
 * KORD CloudURL v1 (Premium)
 * Reply image/video -> Upload to GitHub -> Open in Chrome via Cloudflare Pages
 *
 * Commands:
 *  - cloudurl | curl           -> upload replied media & return viewer URL
 *  - cloudurl direct           -> return direct media URL (no viewer page)
 *  - cloudurl help             -> help
 *  - cloudpass <newpass>       -> set password (owner/mod/sudo only)
 *  - cloudcfg                  -> show config status (safe)
 *  - cloudcancel               -> cancel password session
 *
 * Required setvars:
 *  - CLOUDURL_OWNER, CLOUDURL_REPO, CLOUDURL_BASE, CLOUDURL_TOKEN
 * Optional:
 *  - CLOUDURL_BRANCH (default: main)
 *  - CLOUDURL_DIR (default: media)
 *  - CLOUDURL_VIEWDIR (default: view)
 *  - CLOUDURL_PASS (recommended)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const { kord, wtype, config, prefix } = require("../core");

/* ---------------- SAFE CONFIG ---------------- */
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

/* ---------------- ACCESS ---------------- */
function getSenderId(m) {
  return m?.sender || m?.key?.participant || m?.participant || m?.key?.remoteJid || "unknown";
}
function getChatId(m) {
  return m?.key?.remoteJid || m?.chat || "unknown";
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
      : String(sudoRaw).split(",").map(x => x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

/* ---------------- PASSWORD (File + setvar support) ---------------- */
const DATA_DIR = path.join("/home/container", "cmds", ".cloudurl");
const PASS_FILE = path.join(DATA_DIR, "pass.json");

function ensurePassStore() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try {
    if (!fs.existsSync(PASS_FILE)) fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: "" }, null, 2));
  } catch {}
}
function readPass() {
  ensurePassStore();
  // prefer setvar CLOUDURL_PASS for your “supernpm style”
  const sv = getVar("CLOUDURL_PASS", "").trim();
  if (sv) return sv;
  try {
    const j = JSON.parse(fs.readFileSync(PASS_FILE, "utf8"));
    return String(j.pass || "").trim();
  } catch {
    return "";
  }
}
function writePass(p) {
  ensurePassStore();
  try {
    fs.writeFileSync(PASS_FILE, JSON.stringify({ pass: String(p || "").trim() }, null, 2));
  } catch {}
}

/* ---------------- SESSION (password prompt) ---------------- */
const SESS = new Map();
const TTL = 2 * 60 * 1000;

function skey(m) { return `${getChatId(m)}::${getSenderId(m)}`; }
function setSess(m, data) { SESS.set(skey(m), { ...data, ts: Date.now() }); }
function getSess(m) {
  const k = skey(m);
  const s = SESS.get(k);
  if (!s) return null;
  if (Date.now() - s.ts > TTL) { SESS.delete(k); return null; }
  s.ts = Date.now();
  SESS.set(k, s);
  return s;
}
function clearSess(m) { SESS.delete(skey(m)); }

/* ---------------- UTIL ---------------- */
async function safeReact(m, emoji) {
  try { if (typeof m.react === "function") return await m.react(emoji); } catch {}
  try { if (typeof m.reaction === "function") return await m.reaction(emoji); } catch {}
  try { if (typeof m.sendReaction === "function") return await m.sendReaction(emoji); } catch {}
  return null;
}
function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/g, "");
  const x = String(p || "").replace(/^\/+/g, "");
  return `${b}/${x}`;
}
function cleanRepoPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/g, "").replace(/\.\.+/g, ".");
}
function extFromMime(mime) {
  const x = String(mime || "").toLowerCase();
  if (x.includes("image/jpeg")) return "jpg";
  if (x.includes("image/png")) return "png";
  if (x.includes("image/webp")) return "webp";
  if (x.includes("image/gif")) return "gif";
  if (x.includes("video/mp4")) return "mp4";
  if (x.includes("video/webm")) return "webm";
  if (x.includes("video/quicktime")) return "mov";
  return "";
}
function isVideoExt(ext){ return ["mp4","webm","mov","mkv"].includes(ext); }
function isImageExt(ext){ return ["jpg","jpeg","png","gif","webp"].includes(ext); }

function makeViewerHtml({ title, mediaUrl, ext }) {
  const isVid = isVideoExt(ext);
  const isImg = isImageExt(ext);

  const body = isVid
    ? `<video controls autoplay playsinline style="max-width:100%;border-radius:14px" src="${mediaUrl}"></video>`
    : isImg
      ? `<img style="max-width:100%;border-radius:14px" src="${mediaUrl}" />`
      : `<a href="${mediaUrl}">Open file</a>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1"േഴ
<title>${title}</title>
<style>
  body{margin:0;background:#070b0a;color:#eafff6;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .wrap{max-width:980px;margin:0 auto;padding:18px}
  .card{background:rgba(0,0,0,.45);border:2px solid #1ccf7b;border-radius:18px;padding:14px}
  .top{display:flex;gap:10px;align-items:center;margin-bottom:12px}
  .dot{width:10px;height:10px;border-radius:50%;background:#27ff9a;box-shadow:0 0 12px #27ff9a}
  a{color:#27ff9a;word-break:break-all}
</style>
</head>
<body>
  <div class="wrap">
    <div class="top"><div class="dot"></div><div>${title}</div></div>
    <div class="card">
      ${body}
      <div style="margin-top:10px;font-size:12px;opacity:.85">
        Source: <a href="${mediaUrl}">${mediaUrl}</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ---------------- DOWNLOAD MEDIA FROM WHATSAPP ---------------- */
async function getQuotedOrSelf(m) {
  return m?.quoted || m?.reply_message || m?.msg?.quoted || null;
}

async function downloadMediaBuffer(m) {
  // try quoted first, then message itself
  const q = await getQuotedOrSelf(m);
  const target = q || m;

  // Strategy 1: common helpers
  try { if (target && typeof target.download === "function") return await target.download(); } catch {}
  try { if (target && typeof target.downloadMedia === "function") return await target.downloadMedia(); } catch {}

  // Strategy 2: Baileys style
  try {
    if (m?.client?.downloadMediaMessage) return await m.client.downloadMediaMessage(target);
  } catch {}

  // Strategy 3: if core provides a buffer already
  try { if (target?.buffer && Buffer.isBuffer(target.buffer)) return target.buffer; } catch {}

  return null;
}

function detectMime(m) {
  const q = m?.quoted || m?.reply_message || m?.msg?.quoted || null;
  const obj = q || m;

  const msg = obj?.message || obj?.msg || obj;
  const mt =
    msg?.mimetype ||
    msg?.mtype ||
    msg?.mime ||
    msg?.message?.mimetype ||
    msg?.imageMessage?.mimetype ||
    msg?.videoMessage?.mimetype ||
    obj?.mimetype ||
    "";

  return String(mt || "");
}

/* ---------------- GITHUB API (create/update file) ---------------- */
function ghRequest({ token, method, pathUrl, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(
      {
        hostname: "api.github.com",
        path: pathUrl,
        method: method || "GET",
        headers: {
          "User-Agent": "KORD-CloudURL",
          "Accept": "application/vnd.github+json",
          "Authorization": `token ${token}`,
          ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, json, raw });
          const msg = (json && (json.message || json.error)) ? (json.message || json.error) : raw;
          return reject(new Error(`GitHub API ${res.statusCode}: ${msg}`));
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ghGetSha({ token, owner, repo, branch, filePath }) {
  const p = cleanRepoPath(filePath);
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(p)}?ref=${encodeURIComponent(branch)}`;
  try {
    const r = await ghRequest({ token, method: "GET", pathUrl: url });
    return r?.json?.sha || null;
  } catch {
    return null;
  }
}

async function ghPutFile({ token, owner, repo, branch, filePath, buffer, message }) {
  const p = cleanRepoPath(filePath);
  const sha = await ghGetSha({ token, owner, repo, branch, filePath: p });

  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(p)}`;
  const body = {
    message: message || `CloudURL upload ${p}`,
    content: Buffer.from(buffer).toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };

  const r = await ghRequest({ token, method: "PUT", pathUrl: url, body });
  // return repo path
  return { path: p, commit: r?.json?.commit?.sha || "" };
}
/* ---------------- CORE ACTION ---------------- */
function getCloudCfg() {
  const owner = getVar("CLOUDURL_OWNER", "").trim();
  const repo = getVar("CLOUDURL_REPO", "").trim();
  const base = getVar("CLOUDURL_BASE", "").trim();
  const token = getVar("CLOUDURL_TOKEN", "").trim();
  const branch = getVar("CLOUDURL_BRANCH", "main").trim() || "main";
  const dir = getVar("CLOUDURL_DIR", "media").trim() || "media";
  const viewDir = getVar("CLOUDURL_VIEWDIR", "view").trim() || "view";
  return { owner, repo, base, token, branch, dir, viewDir };
}

function cfgOk(c) {
  return !!(c.owner && c.repo && c.base && c.token);
}

function genName(ext) {
  const id = crypto.randomBytes(6).toString("hex");
  const ts = Date.now();
  const e = ext ? String(ext).toLowerCase() : "bin";
  return `kord_${ts}_${id}.${e}`;
}

async function doUploadAndReturnUrl(m, mode) {
  const c = getCloudCfg();
  if (!cfgOk(c)) {
    throw new Error(
      "CloudURL not configured. Set: CLOUDURL_OWNER, CLOUDURL_REPO, CLOUDURL_BASE, CLOUDURL_TOKEN (and optional CLOUDURL_BRANCH)."
    );
  }

  const buf = await downloadMediaBuffer(m);
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 10) {
    throw new Error("Reply/tag an image or video then run cloudurl.");
  }

  const mime = detectMime(m);
  let ext = extFromMime(mime);
  if (!ext) ext = "bin";

  const filename = genName(ext);
  const mediaPath = `${c.dir.replace(/^\/+|\/+$/g, "")}/${filename}`;

  // Upload media to GitHub
  const up = await ghPutFile({
    token: c.token,
    owner: c.owner,
    repo: c.repo,
    branch: c.branch,
    filePath: mediaPath,
    buffer: buf,
    message: `CloudURL media ${filename}`,
  });

  const mediaUrl = joinUrl(c.base, up.path);

  if (String(mode).toLowerCase() === "direct") {
    await safeReact(m, "✅");
    if (m.reply) return m.reply(`✅ CloudURL (Direct)\n${mediaUrl}`);
    return null;
  }

  // viewer page
  const viewName = filename.replace(/\.[^.]+$/, "") + ".html";
  const viewPath = `${c.viewDir.replace(/^\/+|\/+$/g, "")}/${viewName}`;

  const html = makeViewerHtml({ title: "KORD CLOUD VIEW", mediaUrl, ext });
  const viewUp = await ghPutFile({
    token: c.token,
    owner: c.owner,
    repo: c.repo,
    branch: c.branch,
    filePath: viewPath,
    buffer: Buffer.from(html, "utf8"),
    message: `CloudURL view ${viewName}`,
  });

  const pageUrl = joinUrl(c.base, viewUp.path);

  await safeReact(m, "✅");
  if (m.reply) return m.reply(`✅ CloudURL (Open in Chrome)\n${pageUrl}`);
  return null;
}

/* ---------------- COMMANDS ---------------- */
kord(
  { cmd: "cloudurl|curl", desc: "Upload media -> Cloudflare Pages URL", fromMe: wtype, type: "tools", react: "☁️" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      const pfx = SAFE_PREFIX();
      const arg = String(text || "").trim().toLowerCase();

      if (!arg || arg === "help") {
        const msg =
          `☁️ *CloudURL v1*\n\n` +
          `Use:\n` +
          `• Reply image/video then: *${pfx}cloudurl*\n` +
          `• Direct link: *${pfx}cloudurl direct*\n\n` +
          `Security:\n` +
          `• Password required (CLOUDURL_PASS)\n` +
          `• Set: *${pfx}cloudpass <newpass>* (owner/mod/sudo)\n\n` +
          `Config:\n` +
          `• *${pfx}cloudcfg*`;
        return m.reply ? m.reply(msg) : null;
      }

      // password gate
      const pass = readPass();
      if (!pass) return m.reply ? m.reply("🔒 CLOUDURL_PASS not set. Set it with: cloudpass <newpass> OR setvar CLOUDURL_PASS=...") : null;

      // if already verified recently, allow (optional)
      // We will ask password every time for premium safety:
      setSess(m, { mode: "await_pass", op: "cloudurl", arg: arg || "" });
      await safeReact(m, "🔒");
      return m.reply ? m.reply("🔒 Enter CloudURL password (next message). Or: cloudcancel") : null;

    } catch (e) {
      return m.reply ? m.reply("❌ cloudurl failed: " + (e?.message || e)) : null;
    }
  }
);

kord(
  { cmd: "cloudpass", desc: "Set CloudURL password", fromMe: wtype, type: "tools", react: "🔐" },
  async (m, text) => {
    if (!isAllowed(m)) return;
    const p = String(text || "").trim();
    if (!p || p.length < 3) return m.reply ? m.reply("Usage: cloudpass <newpassword>") : null;
    writePass(p);
    await safeReact(m, "✅");
    return m.reply ? m.reply("✅ CloudURL password saved.") : null;
  }
);

kord(
  { cmd: "cloudcfg", desc: "Show CloudURL config status", fromMe: wtype, type: "tools", react: "⚙️" },
  async (m) => {
    if (!isAllowed(m)) return;
    const c = getCloudCfg();
    const ok = cfgOk(c);
    const hasPass = !!readPass();
    const msg =
      `⚙️ *CloudURL Config*\n\n` +
      `OWNER   : ${c.owner || "NOT SET"}\n` +
      `REPO    : ${c.repo || "NOT SET"}\n` +
      `BASE    : ${c.base || "NOT SET"}\n` +
      `BRANCH  : ${c.branch || "main"}\n` +
      `DIR     : ${c.dir || "media"}\n` +
      `VIEWDIR : ${c.viewDir || "view"}\n` +
      `TOKEN   : ${c.token ? "SET" : "NOT SET"}\n` +
      `PASS    : ${hasPass ? "SET" : "NOT SET"}\n\n` +
      (ok ? "✅ Ready." : "❌ Missing required setvars.");
    return m.reply ? m.reply(msg) : null;
  }
);

kord(
  { cmd: "cloudcancel", desc: "Cancel CloudURL password prompt", fromMe: wtype, type: "tools", react: "❌" },
  async (m) => {
    if (!isAllowed(m)) return;
    clearSess(m);
    return m.reply ? m.reply("✅ Cancelled.") : null;
  }
);

/* ---------------- PASSWORD LISTENER ---------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;

    const s = getSess(m);
    if (!s || s.mode !== "await_pass") return;

    const raw =
      (typeof textArg === "string" ? textArg : "") ||
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      m?.body ||
      "";

    const passTry = String(raw || "").trim();
    if (!passTry) return;

    const saved = readPass();
    if (!saved) {
      clearSess(m);
      return m.reply ? m.reply("🔒 Password not set. Use cloudpass <newpass>.") : null;
    }

    if (passTry !== saved) {
      await safeReact(m, "❌");
      return m.reply ? m.reply("❌ Wrong password. Try again or: cloudcancel") : null;
    }

    // correct
    clearSess(m);
    await safeReact(m, "✅");
    if (m.reply) await m.reply("✅ Verified. Uploading...");

    const mode = (s.arg || "").toLowerCase() === "direct" ? "direct" : "page";
    return await doUploadAndReturnUrl(m, mode);

  } catch (e) {
    try { clearSess(m); } catch {}
    return m.reply ? m.reply("❌ CloudURL failed: " + (e?.message || e)) : null;
  }
});