const path = require("path");

const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const XAI_URL = "https://api.x.ai/v1/chat/completions";
const ESV_URL = "https://api.esv.org/v3/passage/text/";
const SYSTEM_PROMPT = `You are Abide, a Christian spiritual guidance companion. Return only valid JSON with no markdown, code fences, or extra text. Use exactly this shape:
{
  "verse_ref": "Romans 8:1",
  "message": "A full pastoral response as one flowing paragraph that is honest, warm, and not preachy. Acknowledge that God designed certain desires and emotions for good purposes. Distinguish guilt, which leads back to God, from shame, which is the enemy's weapon. Speak directly to the person.",
  "invitation": "One sentence that opens a door toward intimacy with God, not just behavior change.",
  "prayer": "A 2-3 sentence first-person prayer toward closeness with God, not just asking the struggle to go away."
}
Choose one relevant Bible passage reference. Do not diagnose mental illness, claim divine revelation, or replace professional emergency, medical, or mental-health care.`;

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requireApiKey(name) {
  const key = process.env[name];
  if (!key || key === "your_key_here") {
    const error = new Error(`${name} is not configured.`);
    error.status = 503;
    throw error;
  }
  return key;
}

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpstreamJson(response, serviceName) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.detail;
    const error = new Error(detail || `${serviceName} request failed.`);
    error.status = 502;
    throw error;
  }
  return payload;
}

async function guidanceHandler(req, res, next) {
  try {
    const struggle = cleanString(req.body?.struggle, 4000);
    if (!struggle) {
      return res.status(400).json({ error: "Please share what is on your heart." });
    }

    const response = await fetchWithTimeout(XAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey("GROK_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "grok-3",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: struggle }
        ]
      })
    });
    const payload = await readUpstreamJson(response, "Guidance");
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      const error = new Error("Guidance response was empty.");
      error.status = 502;
      throw error;
    }

    let guidance;
    try {
      guidance = JSON.parse(content);
    } catch {
      const error = new Error("Guidance response was not valid JSON.");
      error.status = 502;
      throw error;
    }

    const result = {
      verse_ref: cleanString(guidance.verse_ref, 120),
      message: cleanString(guidance.message, 6000),
      invitation: cleanString(guidance.invitation, 1000),
      prayer: cleanString(guidance.prayer, 2000)
    };
    if (Object.values(result).some((value) => !value)) {
      const error = new Error("Guidance response was incomplete.");
      error.status = 502;
      throw error;
    }
  } catch (error) {
    next(error);
  }
}

module.exports = app;
