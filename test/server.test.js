const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");

process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.ESV_API_KEY = "test-esv-key";

const app = require("../server");

let baseUrl;
let server;
let originalFetch;

before(async () => {
  originalFetch = global.fetch;
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.ESV_API_KEY = "test-esv-key";
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function post(path, body) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

async function get(path) {
  const response = await originalFetch(`${baseUrl}${path}`);
  return { response, payload: await response.json() };
}

test("health check confirms the local server is ready", async () => {
  const { response, payload } = await get("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { status: "ok" });
});

test("guidance rejects an empty struggle", async () => {
  const { response, payload } = await post("/api/guidance", { struggle: " " });

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Please share what is on your heart.");
});

test("guidance returns validated structured content", async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");
    assert.equal(options.headers.get("x-goog-api-key"), "test-gemini-key");
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");

    return Response.json({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              verse_ref: "Romans 8:1",
              message: "You can bring this honestly to God.",
              invitation: "Let yourself be known by God here.",
              prayer: "God, I come close to you. Hold me in your grace.",
              follow_up_question: "Where do you notice shame speaking the loudest right now?"
            })
          }]
        }
      }]
    });
  };

  const { response, payload } = await post("/api/guidance", {
    struggle: "I feel ashamed."
  });

  assert.equal(response.status, 200);
  assert.equal(payload.verse_ref, "Romans 8:1");
  assert.match(payload.message, /honestly/);
  assert.match(payload.follow_up_question, /shame/);
});

test("guidance includes recent conversation context", async () => {
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;
    assert.match(prompt, /Conversation so far:/);
    assert.match(prompt, /Person: I feel ashamed\./);
    assert.match(prompt, /Abide: God meets you tenderly\./);
    assert.match(prompt, /Newest share:\nIt feels worse at night\./);

    return Response.json({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              verse_ref: "Psalm 4:8",
              message: "Night can make fear feel louder, but God is still near.",
              invitation: "Let God be present with you before you try to fix it.",
              prayer: "God, stay near to me tonight. Teach my body to rest in your care.",
              follow_up_question: "What tends to happen in the hour before it gets worse?"
            })
          }]
        }
      }]
    });
  };

  const { response, payload } = await post("/api/guidance", {
    struggle: "It feels worse at night.",
    conversation: [
      { role: "user", text: "I feel ashamed." },
      { role: "abide", text: "God meets you tenderly." }
    ]
  });

  assert.equal(response.status, 200);
  assert.equal(payload.verse_ref, "Psalm 4:8");
  assert.match(payload.follow_up_question, /hour before/);
});

test("guidance preserves actionable upstream errors", async () => {
  global.fetch = async () => Response.json(
    { error: { message: "The API account has no credits." } },
    { status: 403 }
  );

  const { response, payload } = await post("/api/guidance", {
    struggle: "I feel discouraged."
  });

  assert.equal(response.status, 502);
  assert.equal(payload.error, "The API account has no credits.");
});

test("verse returns clean canonical scripture", async () => {
  global.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/api\.esv\.org\/v3\/passage\/text\/\?/);
    assert.equal(options.headers.Authorization, "Token test-esv-key");
    return Response.json({
      canonical: "Romans 8:1",
      passages: ["There is therefore now no condemnation..."]
    });
  };

  const { response, payload } = await post("/api/verse", {
    reference: "Romans 8:1"
  });

  assert.equal(response.status, 200);
  assert.equal(payload.reference, "Romans 8:1");
  assert.match(payload.verse, /no condemnation/);
});

test("unknown API routes return JSON", async () => {
  const { response, payload } = await post("/api/missing", {});

  assert.equal(response.status, 404);
  assert.equal(payload.error, "API route not found.");
});
