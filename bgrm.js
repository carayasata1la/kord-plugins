const { kord, wtype } = require("../core");

// You need fetch + FormData in Node.
// If you're on Node 18+, fetch is built-in.
// For FormData, Node 18+ has global FormData (via undici).
// If not available, install: npm i form-data node-fetch
// and adapt imports.
kord(
  {
    cmd: "rmvbg|removevbg",
    desc: "Remove video background (API-based)",
    fromMe: wtype,
    type: "user",
  },
  async (m, text) => {
    const PREFIX = process.env.PREFIX || ".";
    const sendAsDocument =
      text && typeof text === "string" && (text.includes("-d") || text.trim().endsWith("-d"));

    // ---- Configure your API endpoints (replace with your real service) ----
    const API_BASE = process.env.VIDEO_RMBG_API_BASE; // e.g. "https://your-service.com"
    const API_KEY = process.env.VIDEO_RMBG_API_KEY;   // optional

    // Example endpoints:
    // POST   `${API_BASE}/api/video/removebg`  -> { jobId: "..." }
    // GET    `${API_BASE}/api/video/status/:jobId` -> { status: "queued|processing|done|error", resultUrl?: "..." }
    // (or return result binary directly from a download endpoint)
    const START_ENDPOINT = `${API_BASE}/api/video/removebg`;
    const STATUS_ENDPOINT = (jobId) => `${API_BASE}/api/video/status/${encodeURIComponent(jobId)}`;

    if (!API_BASE) {
      return m.send(
        "VIDEO_RMBG_API_BASE is not set. Ask your dev to set an API base URL for the video remove-bg service."
      );
    }

    // Ensure a video is quoted
    const quoted = m.quoted;
    const isQuotedVideo =
      quoted &&
      (quoted.video === true ||
        quoted.isVideo === true ||
        quoted.mtype === "videoMessage" ||
        quoted.message?.videoMessage);

    if (!isQuotedVideo) {
      return m.send(`Reply to a *video* with ${PREFIX}removevbg to remove its background.\nTip: add *-d* to send as document.`);
    }

    try {
      if (m.react) await m.react("⏳");
      await m.send("Uploading video for background removal...");

      // 1) Download the quoted video
      const media = await quoted.download(); // Buffer / Uint8Array
      const videoBuffer = Buffer.from(media);

      // 2) Upload to your API (multipart/form-data)
      const form = new FormData();
      // Some services like a filename + mime
      const blob = new Blob([videoBuffer], { type: "video/mp4" }); // may be okay even if original isn't mp4
      form.append("file", blob, "input.mp4");
// Optional options you might support server-side
      // form.append("output", "mp4"); // or "webm"
      // form.append("bg", "transparent"); // if service supports alpha video (often webm)
      // form.append("bg", "#00FF00"); // if you want a green background, etc.

      const startRes = await fetch(START_ENDPOINT, {
        method: "POST",
        headers: API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : undefined,
        body: form,
      });

      if (!startRes.ok) {
        if (m.react) await m.react("❌");
        const errText = await startRes.text().catch(() => "");
        return m.send(`Failed to start processing.\n${errText ? `Server: ${errText}` : ""}`);
      }

      const startJson = await startRes.json();
      const jobId = startJson.jobId;
      if (!jobId) {
        if (m.react) await m.react("❌");
        return m.send("API did not return a jobId.");
      }

      // 3) Poll for completion
      await m.send("Processing... (this can take a bit for longer videos)");
      const maxWaitMs = 3 * 60 * 1000; // 3 minutes
      const pollEveryMs = 4000;
      const startedAt = Date.now();

      let resultUrl = null;
      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollEveryMs));

        const statusRes = await fetch(STATUS_ENDPOINT(jobId), {
          method: "GET",
          headers: API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : undefined,
        });

        if (!statusRes.ok) continue;

        const statusJson = await statusRes.json();
        const status = statusJson.status;

        if (status === "done") {
          resultUrl = statusJson.resultUrl;
          break;
        }
        if (status === "error") {
          if (m.react) await m.react("❌");
          return m.send("Processing failed on the server (status=error).");
        }
      }
if (!resultUrl) {
        if (m.react) await m.react("❌");
        return m.send("Timed out waiting for processing. Try a shorter video or increase the maxWaitMs in the plugin.");
      }

      // 4) Download result and send back
      const outRes = await fetch(resultUrl, {
        method: "GET",
        headers: API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : undefined,
      });

      if (!outRes.ok) {
        if (m.react) await m.react("❌");
        return m.send("Could not download processed video.");
      }

      const outArrayBuf = await outRes.arrayBuffer();
      const outBuffer = Buffer.from(outArrayBuf);

      if (m.react) await m.react("✅");

      const outMime = "video/mp4";
      if (sendAsDocument) {
        await m.send(
          outBuffer,
          { fileName: "removebg-video.mp4", mimetype: outMime, quoted: m },
          "document"
        );
      } else {
        await m.send(outBuffer, { mimetype: outMime }, "video");
      }
    } catch (e) {
      if (m.react) await m.react("❌");
      return m.send("Error processing video background removal.");
    }
  }
);