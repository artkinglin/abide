# Abide

Abide is a small Christian spiritual guidance app. The browser sends each share
to the Express server with recent conversation context, which requests a
structured pastoral response and follow-up question from Gemini, then retrieves
the selected passage from the ESV API. API keys remain on the server.

## Run locally

1. Install dependencies with `npm install`.
2. Replace the placeholder values in `.env` with your Gemini and ESV API keys.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.
5. Confirm the server is ready at `http://localhost:3000/api/health`.

Node.js 18 or newer is required.
