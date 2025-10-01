import express from "express";
import cors from "cors";

// === Importy handlerów ===
// AI / multimodalne
import ttsHandler from "./tts.js";
import sttHandler from "./stt.js";
import whisperHandler from "./whisper.js";
import geminiHandler from "./gemini.js";
import geminiStreamHandler from "./gemini-stream.js";
import gptHandler from "./gpt.js";

// Restauracje / menu / zamówienia
import restaurantsHandler from "./restaurants.js";
import menuHandler from "./menu.js";
import ordersHandler from "./orders.js";
import orderStatusHandler from "./order-status.js";
import orderRoutingHandler from "./order-routing.js";

// Biznes
import businessRegisterHandler from "./business-register.js";
import businessPanelHandler from "./business-panel.js";
import businessCategoriesHandler from "./business-categories.js";
import businessLeadsHandler from "./business_leads.js";

// Inne
import authHandler from "./auth.js";
import placesHandler from "./places.js";
import envTestHandler from "./env-test.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// === Endpointy ===
// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// AI
app.post("/api/tts", ttsHandler);
app.post("/api/stt", sttHandler);
app.post("/api/whisper", whisperHandler);
app.post("/api/gemini-agent", geminiHandler);
app.post("/api/gemini-stream", geminiStreamHandler);
app.post("/api/gpt", gptHandler);

// Restauracje / menu / zamówienia
app.get("/api/restaurants", restaurantsHandler);
app.get("/api/menu", menuHandler);
app.get("/api/orders", ordersHandler);
app.get("/api/order-status", orderStatusHandler);
app.get("/api/order-routing", orderRoutingHandler);

// Biznes
app.post("/api/business-register", businessRegisterHandler);
app.get("/api/business-panel", businessPanelHandler);
app.get("/api/business-categories", businessCategoriesHandler);
app.get("/api/business-leads", businessLeadsHandler);

// Inne
app.post("/api/auth", authHandler);
app.get("/api/places", placesHandler);
app.get("/api/env-test", envTestHandler);

// Export dla Vercela (jeden monolit = jeden endpoint)
export default app;
