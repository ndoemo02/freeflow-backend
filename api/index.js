import express from "express";
import cors from "cors";
import serverless from "serverless-http";

// === importy handlerów ===
import ttsHandler from "../lib/tts.js";
import sttHandler from "../lib/stt.js";
import whisperHandler from "../lib/whisper.js";
import geminiHandler from "../lib/gemini.js";
import geminiStreamHandler from "../lib/gemini-stream.js";
import gptHandler from "../lib/gpt.js";

import restaurantsHandler from "../lib/restaurants.js";
import menuHandler from "../lib/menu.js";
import ordersHandler from "../lib/orders.js";
import orderStatusHandler from "../lib/order-status.js";
import orderRoutingHandler from "../lib/order-routing.js";

import businessRegisterHandler from "../lib/business-register.js";
import businessPanelHandler from "../lib/business-panel.js";
import businessCategoriesHandler from "../lib/business-categories.js";
import businessLeadsHandler from "../lib/business_leads.js";

import authHandler from "../lib/auth.js";
import placesHandler from "../lib/places.js";
import envTestHandler from "../lib/env-test.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// === Endpointy ===
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/tts", ttsHandler);
app.post("/api/stt", sttHandler);
app.post("/api/whisper", whisperHandler);
app.post("/api/gemini-agent", geminiHandler);
app.post("/api/gemini-stream", geminiStreamHandler);
app.post("/api/gpt", gptHandler);

app.get("/api/restaurants", restaurantsHandler);
app.get("/api/menu", menuHandler);
app.get("/api/orders", ordersHandler);
app.get("/api/order-status", orderStatusHandler);
app.get("/api/order-routing", orderRoutingHandler);

app.post("/api/business-register", businessRegisterHandler);
app.get("/api/business-panel", businessPanelHandler);
app.get("/api/business-categories", businessCategoriesHandler);
app.get("/api/business-leads", businessLeadsHandler);

app.post("/api/auth", authHandler);
app.get("/api/places", placesHandler);
app.get("/api/env-test", envTestHandler);

// === Export jako funkcja serverless ===
export const handler = serverless(app);
export default handler;
