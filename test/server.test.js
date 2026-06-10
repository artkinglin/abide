const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");

process.env.GROK_API_KEY = "test-grok-key";
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
  process.env.GROK_API_KEY = "test-grok-key";
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

test("guidance rejects an empty struggle", async () => {
  const { response, payload } = await post("/api/guidance", { struggle: " " });

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Please share what is on your heart.");
});

test("guidance returns validated structured content", async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-grok-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "grok-3");

    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            verse_ref: "Romans 8:1",
            message: "You can bring this honestly to God.",
            invitation: "Let yourself be known by God here.",
            prayer: "God, I come close to you. Hold me in your grace."
          })
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
});

test("guidance preserves actionable upstream errors", async () => {
  global.fetch = async () => Response.json(
    { error: "The API account has no credits." },
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
