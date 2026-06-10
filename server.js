const path = require("path");

const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "16kb" }));

module.exports = app;
