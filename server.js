const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ESV_URL = "https://api.esv.org/v3/passage/text/";
const SYSTEM_PROMPT = `You are Abide, a Christian spiritual guidance companion. Return only valid JSON with no markdown, code fences, or extra text. Use exactly this shape:
{
  "verse_ref": "Romans 8:1",
  "message": "A full pastoral response as one flowing paragraph that is honest, warm, and not preachy. Acknowledge that God designed certain desires and emotions for good purposes. Distinguish guilt, which leads back to God, from shame, which is the enemy's weapon. Speak directly to the person.",
  "invitation": "One sentence that opens a door toward intimacy with God, not just behavior change.",
  "prayer": "A 2-3 sentence first-person prayer toward closeness with God, not just asking the struggle to go away.",
  "follow_up_question": "One gentle, specific question that invites the person to continue the conversation and go one layer deeper."
}
Choose one relevant Bible passage reference. If prior conversation is provided, respond to the newest share in light of that context without repeating earlier guidance. Do not diagnose mental illness, claim divine revelation, or replace professional emergency, medical, or mental-health care.`;

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanConversation(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-8)
    .map((turn) => ({
      role: turn?.role === "abide" ? "abide" : "user",
      text: cleanString(turn?.text, 1200)
    }))
    .filter((turn) => turn.text);
}

function buildGuidancePrompt(struggle, conversation) {
  if (!conversation.length) {
    return struggle;
  }

  const history = conversation
    .map((turn) => `${turn.role === "abide" ? "Abide" : "Person"}: ${turn.text}`)
    .join("\n");

  return `Conversation so far:\n${history}\n\nNewest share:\n${struggle}`;
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
    const detail =
      payload?.error?.message ||
      (typeof payload?.error === "string" ? payload.error : "") ||
      payload?.detail;
    const error = new Error(detail || `${serviceName} request failed.`);
    error.status = 502;
    throw error;
  }
  return payload;
}

async function generateContentWithTimeout(model, request, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await model.generateContent(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function guidanceHandler(req, res, next) {
  try {
    const struggle = cleanString(req.body?.struggle, 4000);
    if (!struggle) {
      return res.status(400).json({ error: "Please share what is on your heart." });
    }
    const conversation = cleanConversation(req.body?.conversation);

    const genAI = new GoogleGenerativeAI(requireApiKey("GEMINI_API_KEY"));
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT
    });
    let geminiResult;
    try {
      geminiResult = await generateContentWithTimeout(model, {
        contents: [{ role: "user", parts: [{ text: buildGuidancePrompt(struggle, conversation) }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      });
    } catch (error) {
      if (error.name === "GoogleGenerativeAIAbortError") {
        error.name = "AbortError";
      } else {
        const actionableMessage = error.message?.match(/\[\d+\s[^\]]*\]\s(.+)$/)?.[1];
        if (actionableMessage) {
          error.message = actionableMessage;
        }
        error.status = 502;
      }
      throw error;
    }

    const content = geminiResult?.response?.text();
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
      prayer: cleanString(guidance.prayer, 2000),
      follow_up_question: cleanString(guidance.follow_up_question, 1000)
    };
    if (Object.values(result).some((value) => !value)) {
      const error = new Error("Guidance response was incomplete.");
      error.status = 502;
      throw error;
    }

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

app.post("/api/guidance", guidanceHandler);

async function verseHandler(req, res, next) {
  try {
    const reference = cleanString(req.body?.reference, 120);
    if (!reference) {
      return res.status(400).json({ error: "A verse reference is required." });
    }

    const params = new URLSearchParams({
      q: reference,
      "include-passage-references": "false",
      "include-verse-numbers": "false",
      "include-footnotes": "false",
      "include-headings": "false"
    });
    const response = await fetchWithTimeout(`${ESV_URL}?${params}`, {
      headers: {
        Authorization: `Token ${requireApiKey("ESV_API_KEY")}`
      }
    });
    const payload = await readUpstreamJson(response, "Scripture");
    const verse = cleanString(payload?.passages?.[0], 8000);
    if (!verse) {
      return res.status(404).json({ error: "That passage could not be found." });
    }

    return res.json({
      reference: cleanString(payload.canonical, 120) || reference,
      verse
    });
  } catch (error) {
    next(error);
  }
}

app.post("/api/verse", verseHandler);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const timedOut = error.name === "AbortError";
  const status = timedOut ? 504 : error.status || 500;
  const message = timedOut
    ? "The request took too long. Please try again."
    : error.message || "Something went wrong.";

  console.error(error);
  return res.status(status).json({ error: message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Abide is listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
