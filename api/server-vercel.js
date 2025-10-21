// --- FreeFlow Serverless Adapter for Vercel ---
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';

// --- App setup ---
const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('tiny'));

// --- Env sanity ---
console.log('🚀 Booting FreeFlow Serverless...');
console.log('🔑 SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅' : '❌');

// --- Supabase client ---
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Amber is alive 🧠💬' });
});

// --- Environment check ---
app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV
  });
});

// === AMBER BRAIN ===
app.post("/api/brain", async (req, res) => {
  try {
    const brainRouter = await import("./brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (error) {
    console.error("❌ Brain error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/brain/router", async (req, res) => {
  try {
    const brainRouter = await import("./brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === RESTAURANTS ===
app.get("/api/restaurants", async (req, res) => {
  try {
    const { data, error } = await supabase.from("restaurants").select("*");
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === ORDERS ===
app.get("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === MENU ===
app.get("/api/menu", async (req, res) => {
  try {
    const menuHandler = await import("./menu.js");
    return menuHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Export handler for Vercel ---
export default app;


