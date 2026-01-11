/**
 * CF DEPLOY v1 — WhatsApp -> GitHub commit -> Cloudflare Pages URL (password locked)
 * File: /home/container/cmds/deploy.js
 *
 * Commands:
 *  - .deploy auth <pass>     (unlock for 5 minutes)
 *  - .deploy start <file.js> (start new file buffer)
 *  - .deploy add             (append replied text OR next messages)
 *  - .deploy push            (commit to GitHub + return pages URL)
 *  - .deploy cancel          (clear session)
 *  - .deploy status          (show current session state)
 *
 * Notes:
 *  - DOES NOT execute user code. Only uploads to repo.
 *  - Uses GitHub REST API (no extra packages)
 */

const https = require("https");
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

/* ---------------- ACCESS CONTROL (owner/sudo/mod best-effort) ---------------- */
function getSenderId(m) {
  return (
    m?.sender ||
    m?.key?.participant ||
    m?.participant ||
    m?.key?.remoteJid ||
    "unknown"
  );
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
      : String(sudoRaw).split(",").map((x) => x.trim()).filter(Boolean);
    if (list.includes(sender)) return true;
  }
  return false;
}

/* ---------------- TEXT HELPERS ---------------- */
function getTextFromAny(m, textArg) {
  const t =
    (typeof textArg === "string" ? textArg : "") ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.text ||
    m?.body ||
    "";
  return String(t || "");
}

/* ---------------- SESSIONS ---------------- */
const SESS = new Map();
// per-user session: { authedUntil, file, buf, addMode }
const TTL_AUTH_MS = 5 * 60 * 1000; // 5 minutes
const TTL_SESSION_MS = 10 * 60 * 1000; // 10 minutes

function skey(m) {
  return `${getChatId(m)}::${getSenderId(m)}`;
}

function now() { return Date.now(); }

function getSess(m) {
  const k = skey(m);
  const s = SESS.get(k);
  if (!s) return null;
  if (s.sessionTs && (now() - s.sessionTs > TTL_SESSION_MS)) {
    SESS.delete(k);
    return null;
  }
  return s;
}

function setSess(m, patch) {
  const k = skey(m);
  const prev = SESS.get(k) || {};
  const next = { ...prev, ...patch, sessionTs: now() };
  SESS.set(k, next);
  return next;
}

function clearSess(m) {
  SESS.delete(skey(m));
}

/* ---------------- PASSWORD CHECK ---------------- */
function isAuthed(m) {
  const s = getSess(m);
  return !!(s && s.authedUntil && now() < s.authedUntil);
}

function safeCompare(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/* ---------------- GITHUB API ---------------- */
function ghRequest({ method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;

    const req = https.request(
      {
        hostname: "api.github.com",
        path,
        method,
        headers: {
          "User-Agent": "kord-deploy-bot",
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
          const msg = (json && (json.message || json.error)) ? (json.message || json.error) : raw;
          reject(new Error(`GitHub API ${res.statusCode}: ${msg}`));
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ghGetFileSha({ owner, repo, branch, filePath, token }) {
  try {
    const res = await ghRequest({
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`,
      token,
    });
    return res?.json?.sha || null;
  } catch (e) {
    // if file doesn't exist, GitHub returns 404
    if (String(e.message || "").includes("GitHub API 404")) return null;
    throw e;
  }
}

async function ghUpsertFile({ owner, repo, branch, filePath, contentText, token }) {
  const sha = await ghGetFileSha({ owner, repo, branch, filePath, token });

  const b64 = Buffer.from(contentText, "utf8").toString("base64");
  const message = sha ? `update ${filePath}` : `add ${filePath}`;

  const res = await ghRequest({
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}`,
    token,
    body: {
      message,
      content: b64,
      branch,
      ...(sha ? { sha } : {}),
    },
  });

  return {
    committed: true,
    commitSha: res?.json?.commit?.sha || null,
    htmlUrl: res?.json?.content?.html_url || null,
  };
}

/* ---------------- VALIDATIONS ---------------- */
function normalizeFileName(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  // keep simple: only allow .js and safe chars
  if (!/^[a-zA-Z0-9._-]+\.js$/.test(n)) return null;
  return n;
}

function mustGetEnv(m) {
  const GH_TOKEN = getVar("GH_TOKEN", "");
  const DEPLOY_PASS = getVar("DEPLOY_PASS", "");
  const GH_OWNER = getVar("GH_OWNER", "");
  const GH_REPO = getVar("GH_REPO", "");
  const GH_BRANCH = getVar("GH_BRANCH", "master");
  const CF_PAGES_DOMAIN = getVar("CF_PAGES_DOMAIN", "");

  const missing = [];
  if (!GH_TOKEN) missing.push("GH_TOKEN");
  if (!DEPLOY_PASS) missing.push("DEPLOY_PASS");
  if (!GH_OWNER) missing.push("GH_OWNER");
  if (!GH_REPO) missing.push("GH_REPO");
  if (!CF_PAGES_DOMAIN) missing.push("CF_PAGES_DOMAIN");

  if (missing.length) {
    const pfx = SAFE_PREFIX();
    m.reply?.(
      `❌ Missing ENV: ${missing.join(", ")}\n\n` +
      `Set them in your Panel ENV (recommended).\n` +
      `Then restart.\n\n` +
      `Tip: auth with: ${pfx}deploy auth <password>`
    );
    return null;
  }

  return { GH_TOKEN, DEPLOY_PASS, GH_OWNER, GH_REPO, GH_BRANCH, CF_PAGES_DOMAIN };
}

/* ---------------- COMMAND HANDLER ---------------- */
kord(
  { cmd: "deploy", desc: "Password-locked GitHub -> Cloudflare Pages deploy", fromMe: wtype, type: "tools", react: "🚀" },
  async (m, text) => {
    try {
      if (!isAllowed(m)) return;

      const env = mustGetEnv(m);
      if (!env) return;

      const pfx = SAFE_PREFIX();
      const raw = String(text || "").trim();
      const args = raw.split(/\s+/).filter(Boolean);
      const sub = (args[0] || "").toLowerCase();

      if (!sub || sub === "help") {
        return m.reply?.(
          `🚀 *CF DEPLOY v1*\n\n` +
          `1) Auth (5 min):\n` +
          `• ${pfx}deploy auth <password>\n\n` +
          `2) Start file:\n` +
          `• ${pfx}deploy start <file.js>\n\n` +
          `3) Add code (repeat to append):\n` +
          `• ${pfx}deploy add\n\n` +
          `4) Push to GitHub + get URL:\n` +
          `• ${pfx}deploy push\n\n` +
          `Other:\n` +
          `• ${pfx}deploy status\n` +
          `• ${pfx}deploy cancel\n\n` +
          `Pages URL format:\n` +
          `https://${env.CF_PAGES_DOMAIN}/<file.js>`
        );
      }

      // AUTH
      if (sub === "auth") {
        const pass = args.slice(1).join(" ").trim();
        if (!pass) return m.reply?.(`Usage: ${pfx}deploy auth <password>`);
        if (!safeCompare(pass, env.DEPLOY_PASS)) return m.reply?.("❌ Wrong password.");

        setSess(m, { authedUntil: now() + TTL_AUTH_MS });
        return m.reply?.(`✅ Auth OK. You are unlocked for 5 minutes.\nNext: ${pfx}deploy start <file.js>`);
      }

      // require auth for everything else
      if (!isAuthed(m)) {
        return m.reply?.(`🔒 Locked.\nAuth first: ${pfx}deploy auth <password>`);
      }

      // STATUS
      if (sub === "status") {
        const s = getSess(m) || {};
        const f = s.file ? s.file : "none";
        const bytes = s.buf ? Buffer.byteLength(s.buf, "utf8") : 0;
        return m.reply?.(
          `📌 Deploy Status\n` +
          `• File: ${f}\n` +
          `• Buffer: ${bytes} bytes\n` +
          `• Add-mode: ${s.addMode ? "ON" : "OFF"}\n` +
          `• Pages: https://${env.CF_PAGES_DOMAIN}/`
        );
      }

      // CANCEL
      if (sub === "cancel") {
        clearSess(m);
        return m.reply?.("✅ Cleared deploy session.");
      }

      // START
      if (sub === "start") {
        const file = normalizeFileName(args[1]);
        if (!file) {
          return m.reply?.(
            `❌ Invalid filename.\nUse only letters/numbers/._- and must end with .js\nExample: ${pfx}deploy start brain.js`
          );
        }
        setSess(m, { file, buf: "", addMode: false });
        return m.reply?.(`✅ Started: *${file}*\nNow send code with: ${pfx}deploy add`);
      }

      // ADD
      if (sub === "add") {
        const s = getSess(m);
        if (!s || !s.file) return m.reply?.(`Start first: ${pfx}deploy start <file.js>`);

        // If user replied to a message, take that text; else enable addMode so next messages append
        const repliedText =
          m?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
          m?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
          "";

        if (repliedText && String(repliedText).trim()) {
          const next = (s.buf || "") + (s.buf ? "\n" : "") + String(repliedText);
          setSess(m, { buf: next, addMode: false });
          return m.reply?.(`✅ Added replied text. Current size: ${Buffer.byteLength(next, "utf8")} bytes\nPush: ${pfx}deploy push`);
        }

        // turn on add mode
        setSess(m, { addMode: true });
        return m.reply?.("✍️ Add-mode ON.\nNow paste your code (can be multiple messages).\nWhen done: deploy push\nTo stop add-mode: deploy add (again) after you pasted.");
      }

      // PUSH
      if (sub === "push") {
        const s = getSess(m);
        if (!s || !s.file) return m.reply?.(`Start first: ${pfx}deploy start <file.js>`);

        const code = String(s.buf || "").trim();
        if (!code) return m.reply?.(`❌ No code added.\nUse: ${pfx}deploy add`);

        // sanity limit (avoid ENOSPC / huge messages)
        const maxBytes = 180 * 1024; // 180 KB
        const bytes = Buffer.byteLength(code, "utf8");
        if (bytes > maxBytes) {
          return m.reply?.(`❌ Too large (${bytes} bytes). Keep under ~180KB or split into smaller file.`);
        }

        await m.reply?.("⏫ Uploading to GitHub...");

        const result = await ghUpsertFile({
          owner: env.GH_OWNER,
          repo: env.GH_REPO,
          branch: env.GH_BRANCH,
          filePath: s.file,
          contentText: code,
          token: env.GH_TOKEN,
        });

        const url = `https://${env.CF_PAGES_DOMAIN}/${encodeURIComponent(s.file)}`;

        // keep session but stop addMode
        setSess(m, { addMode: false });

        return m.reply?.(
          `✅ Deployed: *${s.file}*\n` +
          `• Commit: ${result.commitSha || "ok"}\n` +
          `• Pages URL: ${url}\n\n` +
          `Note: Cloudflare may take a short moment to publish after commit.`
        );
      }

      return m.reply?.(`Unknown subcommand. Use: ${pfx}deploy help`);
    } catch (e) {
      return m.reply?.(`❌ deploy failed: ${e.message}`);
    }
  }
);

/* ------------- OPTIONAL: APPEND MODE LISTENER ------------- */
kord({ on: "all" }, async (m, textArg) => {
  try {
    if (!isAllowed(m)) return;

    const env = getVar("GH_TOKEN", "") ? true : false;
    if (!env) return;

    const s = getSess(m);
    if (!s || !s.addMode) return;
    if (!isAuthed(m)) return;

    const pfx = SAFE_PREFIX();
    const raw = getTextFromAny(m, textArg).trim();
    if (!raw) return;

    // don’t capture deploy commands themselves
    const low = raw.toLowerCase();
    if (low.startsWith(`${pfx}deploy`) || low.startsWith("deploy ")) return;

    const next = (s.buf || "") + (s.buf ? "\n" : "") + raw;
    setSess(m, { buf: next });

    // lightweight ack (no spam)
    if (typeof m.react === "function") await m.react("➕");
  } catch {}
});
