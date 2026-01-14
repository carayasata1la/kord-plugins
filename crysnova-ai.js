/* [SWITCH PATCH — PART 1/3] */
/* Put this near your ENV/OPENAI section (where OPENAI_API_KEY / MODEL is). */

const CRYS_PROVIDER_DEFAULT = (process.env.CRYS_PROVIDER || "openai").trim().toLowerCase();
const CRYS_MODEL_DEFAULT = (process.env.CRYS_MODEL || "gpt-4o-mini").trim();

const CRYS_FALLBACK_PROVIDER = (process.env.CRYS_FALLBACK_PROVIDER || "").trim().toLowerCase();
const CRYS_FALLBACK_MODEL = (process.env.CRYS_FALLBACK_MODEL || "").trim();

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const HF_TOKEN = (process.env.HF_TOKEN || "").trim();

function getRuntimeProvider(m) {
  const chat = getChatPrefs(m);
  return (chat.provider || CRYS_PROVIDER_DEFAULT || "openai").toLowerCase();
}
function getRuntimeModel(m) {
  const chat = getChatPrefs(m);
  return (chat.model || CRYS_MODEL_DEFAULT || "gpt-4o-mini").trim();
}
function setRuntimeProvider(m, p) {
  p = String(p || "").trim().toLowerCase();
  const ok = ["openai", "openrouter", "groq", "gemini", "hf"].includes(p);
  if (!ok) return null;
  setChatPrefs(m, { provider: p });
  return p;
}
function setRuntimeModel(m, model) {
  model = String(model || "").trim();
  if (!model || model.length > 80) return null;
  setChatPrefs(m, { model });
  return model;
}

function providerKeyOk(p) {
  if (p === "openai") return !!OPENAI_API_KEY;
  if (p === "openrouter") return !!OPENROUTER_API_KEY;
  if (p === "groq") return !!GROQ_API_KEY;
  if (p === "gemini") return !!GEMINI_API_KEY;
  if (p === "hf") return !!HF_TOKEN;
  return false;
}

function isQuotaLike(errMsg) {
  const s = String(errMsg || "").toLowerCase();
  return (
    s.includes("429") ||
    s.includes("rate limit") ||
    s.includes("quota") ||
    s.includes("insufficient_quota") ||
    s.includes("billing hard limit") ||
    s.includes("exceeded your current quota")
  );
}

/* One unified function that calls the current provider */
async function llmCall({ provider, model, messages, temperature }) {
  provider = String(provider || "").toLowerCase();
  model = String(model || "").trim();

  // ---- OPENAI (SDK) ----
  if (provider === "openai") {
    if (!openai) throw new Error("OPENAI_API_KEY not set.");
    const resp = await openai.chat.completions.create({
      model,
      messages,
      temperature,
    });
    const out = resp?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error("OpenAI returned empty response.");
    return out;
  }

  // ---- OPENROUTER (OpenAI-compatible REST) ----
  if (provider === "openrouter") {
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set.");
    const r = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model, messages, temperature },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    const out = r?.data?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error("OpenRouter returned empty response.");
    return out;
  }

  // ---- GROQ (OpenAI-compatible REST) ----
  if (provider === "groq") {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set.");
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model, messages, temperature },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    const out = r?.data?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error("Groq returned empty response.");
    return out;
  }

  // ---- GEMINI (Google Generative Language REST) ----
  if (provider === "gemini") {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set.");
    // Convert OpenAI-style messages to Gemini contents
    const contents = (messages || []).map((m) => ({
      role: (m.role === "assistant") ? "model" : "user",
      parts: [{ text: String(m.content || "") }],
    }));

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const r = await axios.post(
      url,
      {
        contents,
        generationConfig: { temperature: Number(temperature || 0.7) },
      },
      { timeout: 60000 }
    );

    const out =
      r?.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("")?.trim();

    if (!out) throw new Error("Gemini returned empty response.");
    return out;
  }

  // ---- HUGGINGFACE (simple text generation) ----
  if (provider === "hf") {
    if (!HF_TOKEN) throw new Error("HF_TOKEN not set.");
    // model example: "mistralai/Mistral-7B-Instruct-v0.2"
    const prompt = (messages || [])
      .map((x) => `${x.role.toUpperCase()}: ${x.content}`)
      .join("\n")
      .slice(-8000);

    const r = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: prompt },
      {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        timeout: 60000,
      }
    );

    // HF returns array sometimes
    const txt =
      Array.isArray(r.data) ? (r.data[0]?.generated_text || "") : (r.data?.generated_text || "");
    const out = String(txt || "").trim();
    if (!out) throw new Error("HuggingFace returned empty response.");
    return out;
  }

  throw new Error("Unknown provider: " + provider);
}
/* [END PART 1/3] */
/* [SWITCH PATCH — PART 2/3] */
/* Replace your aiReply(m, userText, mode) function with this one. */

async function aiReply(m, userText, mode = "chat") {
  if (!userText) throw new Error("Empty message.");

  // cooldown per chat session, not per user
  const cdKey = "ai::" + getChatId(m) + "::" + mode;
  const left = checkCooldownKey(cdKey);
  if (left) throw new Error(`Cooldown: wait ${left}s`);

  const history = loadMem(m).map((x) => ({ role: x.role, content: x.content }));
  const messages = [
    { role: "system", content: baseSystem(mode) },
    ...history.slice(-memCap()),
    { role: "user", content: userText },
  ];

  const provider = getRuntimeProvider(m);
  const model = getRuntimeModel(m);
  const temp = mode === "roast" ? 0.95 : 0.7;

  // try main provider first
  try {
    if (!providerKeyOk(provider)) {
      throw new Error(`Provider "${provider}" key not set in ENV`);
    }
    const out = await llmCall({ provider, model, messages, temperature: temp });
    pushMem(m, "user", userText);
    pushMem(m, "assistant", out);
    return out;
  } catch (e) {
    const msg = e?.message || String(e);

    // if quota/rate limit: try fallback
    if (CRYS_FALLBACK_PROVIDER && CRYS_FALLBACK_MODEL && isQuotaLike(msg)) {
      try {
        if (!providerKeyOk(CRYS_FALLBACK_PROVIDER)) {
          throw new Error(`Fallback "${CRYS_FALLBACK_PROVIDER}" key not set`);
        }
        const out2 = await llmCall({
          provider: CRYS_FALLBACK_PROVIDER,
          model: CRYS_FALLBACK_MODEL,
          messages,
          temperature: temp,
        });
        pushMem(m, "user", userText);
        pushMem(m, "assistant", out2);
        return out2;
      } catch (e2) {
        throw new Error(
          `Primary failed: ${msg}\nFallback failed: ${(e2?.message || e2)}`
        );
      }
    }

    throw new Error(msg);
  }
}
/* [END PART 2/3] */
/* [SWITCH PATCH — PART 3/3] */
/* Add these command handlers INSIDE your main kord cmd router (where you handle subcommands). */

/* Add these under STATUS / SETUP area */
if (sub === "provider") {
  // show current if no args
  if (!rest) {
    const pNow = getRuntimeProvider(m);
    const mNow = getRuntimeModel(m);
    return sendText(
      m,
      `PROVIDER: ${pNow}\nMODEL: ${mNow}\n\nSet:\n${p}crysnova provider openai|openrouter|groq|gemini|hf`
    );
  }

  if (!isAllowed(m)) return;
  const pp = setRuntimeProvider(m, rest);
  if (!pp) {
    return sendText(
      m,
      `Invalid provider.\nUse: ${p}crysnova provider openai|openrouter|groq|gemini|hf`
    );
  }
  return sendText(m, `Provider set: ${pp}\nModel: ${getRuntimeModel(m)}`);
}

if (sub === "model") {
  if (!rest) {
    return sendText(m, `Use: ${p}crysnova model <modelName>`);
  }
  if (!isAllowed(m)) return;
  const mm = setRuntimeModel(m, rest);
  if (!mm) return sendText(m, "Invalid model name.");
  return sendText(m, `Model set: ${mm}\nProvider: ${getRuntimeProvider(m)}`);
}

/* OPTIONAL: quick preset shortcuts */
if (sub === "useopenai") {
  if (!isAllowed(m)) return;
  setRuntimeProvider(m, "openai");
  setRuntimeModel(m, "gpt-4o-mini");
  return sendText(m, "Switched to OpenAI: gpt-4o-mini");
}
if (sub === "usegemini") {
  if (!isAllowed(m)) return;
  setRuntimeProvider(m, "gemini");
  setRuntimeModel(m, "gemini-2.0-flash");
  return sendText(m, "Switched to Gemini: gemini-2.0-flash");
}
if (sub === "usegroq") {
  if (!isAllowed(m)) return;
  setRuntimeProvider(m, "groq");
  setRuntimeModel(m, "llama-3.1-70b-versatile");
  return sendText(m, "Switched to Groq: llama-3.1-70b-versatile");
}
if (sub === "useopenrouter") {
  if (!isAllowed(m)) return;
  setRuntimeProvider(m, "openrouter");
  setRuntimeModel(m, "google/gemini-2.0-flash-lite");
  return sendText(m, "Switched to OpenRouter: google/gemini-2.0-flash-lite");
}

/* Also update your setup output to show provider/model + fallback */
if (sub === "setup") {
  const okAI = OPENAI_API_KEY ? "✅" : "❌";
  const okW = (process.env.OPENWEATHER_API_KEY || "").trim() ? "✅" : "❌";
  const pr = getRuntimeProvider(m);
  const md = getRuntimeModel(m);

  return sendText(
    m,
    `SETUP\n` +
      `Provider: ${pr}\n` +
      `Model: ${md}\n` +
      `Fallback: ${CRYS_FALLBACK_PROVIDER || "-"} / ${CRYS_FALLBACK_MODEL || "-"}\n` +
      `OpenAI Key: ${okAI}\n` +
      `Weather Key: ${okW}\n` +
      `Memory: ${memCap()} turns\n` +
      `Cooldown: ${cdSec()}s\n` +
      `Theme: ${(process.env.CRYS_THEME || "neon")}`
  );
}
/* [END PART 3/3] */