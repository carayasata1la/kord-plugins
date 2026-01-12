const https = require("https");
const http = require("http");
const { kord, wtype } = require("../core");

function isValidHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function fetchBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!isValidHttpUrl(url)) return reject(new Error("Invalid URL"));

    const lib = url.startsWith("https") ? https : http;

    const req = lib.get(url, (res) => {
      // Redirect
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, redirectsLeft - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });

    req.on("error", reject);
  });
}

async function sendVideo(m, buf, caption = "") {
  try {
    if (m?.client?.sendMessage) {
      return await m.client.sendMessage(
        m.chat,
        { video: buf, caption },
        { quoted: m }
      );
    }
  } catch {}
  return m.reply ? m.reply("✅ Video ready (but send method not found).") : null;
}

/**
 * -----------------------
 * 1) VWORKER (video url worker)
 * Usage:
 *   vworker https://example.dev "a cat dancing"
 * It will request:
 *   https://example.dev/video?prompt=...
 * -----------------------
 */
kord(
  { cmd: "vworker", fromMe: wtype, type: "video", desc: "Video from Worker URL" },
  async (m, text) => {
    try {
      const t = String(text || "").trim();
      if (!t) return m.reply("❌ Use: vworker <base_url> <prompt>");

      const firstSpace = t.indexOf(" ");
      if (firstSpace === -1) return m.reply("❌ Use: vworker <base_url> <prompt>");

      const base = t.slice(0, firstSpace).trim();
      const prompt = t.slice(firstSpace + 1).trim();

      if (!isValidHttpUrl(base)) return m.reply("❌ Invalid base URL");
      if (!prompt) return m.reply("❌ Missing prompt");

      // build: BASE/video?prompt=...
      const url = base.replace(/\/+$/, "") + "/video?prompt=" + encodeURIComponent(prompt);

      await m.reply("🎬 Fetching video…");
      const buf = await fetchBuffer(url);

      return await sendVideo(m, buf, `🎬 ${prompt}`);
    } catch (e) {
      return m.reply("❌ VWORKER error: " + (e?.message || e));
    }
  }
);

/**
 * -----------------------
 * 2) VGEN (Replicate)
 * ENV:
 *   REPLICATE_API_TOKEN=...
 *   REPLICATE_MODEL=owner/name   (optional)
 * -----------------------
 * Replicate supports creating a prediction like:
 * POST https://api.replicate.com/v1/models/{owner}/{name}/predictions
 * then poll until succeeded. 2
 */
const REPLICATE_TOKEN = (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN || "").trim();
const REPLICATE_MODEL = (process.env.REPLICATE_MODEL || "lucataco/animatediff").trim();

function apiJson(method, urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          const msg = (json && (json.detail || json.message || json.error)) ? (json.detail || json.message || json.error) : raw;
          reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function vgenReplicate(prompt) {
  if (!REPLICATE_TOKEN) throw new Error("REPLICATE_API_TOKEN not set.");

  const [owner, name] = REPLICATE_MODEL.split("/");
  if (!owner || !name) throw new Error("REPLICATE_MODEL must be like owner/name");

  // Create prediction (model-based endpoint)
  const createUrl = `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;
  let pred = await apiJson(
    "POST",
    createUrl,
    { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    { input: { prompt } }
  );

  if (!pred?.urls?.get) throw new Error("Replicate: prediction start failed.");

  // Poll until done
  const started = Date.now();
  while (true) {
    if (Date.now() - started > 8 * 60 * 1000) throw new Error("Replicate: timeout (8 min)");
    pred = await apiJson("GET", pred.urls.get, { Authorization: `Bearer ${REPLICATE_TOKEN}` });

    if (pred.status === "succeeded") break;
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error("Replicate: " + (pred.error || pred.status));
    }
    await new Promise((r) => setTimeout(r, 3500));
  }

  const out = pred.output;
  const url = Array.isArray(out) ? out[0] : out;
  if (!url || typeof url !== "string") throw new Error("Replicate: no output video URL");

  return await fetchBuffer(url);
}

kord(
  { cmd: "vgen", fromMe: wtype, type: "video", desc: "Generate AI video (Replicate)" },
  async (m, text) => {
    try {
      const prompt = String(text || "").trim();
      if (!prompt) return m.reply("❌ Use: vgen <prompt>");
      if (!REPLICATE_TOKEN) return m.reply("❌ Set REPLICATE_API_TOKEN first.");

      await m.reply("🎬 Generating video…");
      const buf = await vgenReplicate(prompt);

      return await sendVideo(m, buf, `🎬 ${prompt}`);
    } catch (e) {
      return m.reply("❌ VGEN error: " + (e?.message || e));
    }
  }
);