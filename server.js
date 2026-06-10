const path = require("path");

const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const XAI_URL = "https://api.x.ai/v1/chat/completions";
const ESV_URL = "https://api.esv.org/v3/passage/text/";

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

module.exports = app;
