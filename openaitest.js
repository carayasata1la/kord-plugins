import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const r = await client.responses.create({
  model: "gpt-5.2",
  input: "Say: OpenAI API connected ✅",
});

console.log(r.output_text);