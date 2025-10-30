// --- FreeFlow Serverless Adapter for Vercel ---
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';

// --- App setup ---
const app = express();
app.use(express.json());
// CORS (tuż po dotenv.config): tylko podane domeny i metody
app.use(
  cors({
    origin: [
      'https://freeflow-frontend-seven.vercel.app',
      'https://freeflow-frontend.vercel.app'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  })
);
app.use(morgan('tiny'));

// --- Env sanity ---
console.log('🚀 Booting FreeFlow Serverless...');
console.log('🧠 ENV OK');
console.log('🔑 SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅' : '❌');

// --- Supabase client ---
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Health check ---
app.get('/api/health', async (req, res) => {
  const health = {
    ok: true,
    node: process.version,
    service: 'FreeFlow Brain',
    version: process.env.npm_package_version || 'dev',
    timestamp: new Date().toISOString(),
    supabase: { ok: false, time: null }
  };
  try {
    const t0 = performance.now();
    const { data, error } = await supabase.from('restaurants').select('id').limit(1);
    const t1 = performance.now();
    if (error) throw error;
    health.supabase.ok = true;
    health.supabase.time = `${(t1 - t0).toFixed(1)} ms`;
  } catch (err) {
    health.ok = false;
    health.supabase.error = err.message;
  }
  res.json(health);
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
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ ok: false, error: 'missing_text' });
    }
    const brainRouter = await import("./brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (error) {
    console.error("❌ Brain error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 405 dla metod innych niż POST
app.get('/api/brain', (req, res) => {
  res.status(405).json({ ok: false, error: 'method_not_allowed' });
});

    // Optional: reset session endpoint
    app.post("/api/brain/reset", async (req, res) => {
      try {
        const { getSession } = await import("./brain/context.js");
        const { updateSession } = await import("./brain/context.js");
        const body = req.body || {};
        const sessionId = body.sessionId;
        if (!sessionId) return res.status(400).json({ ok: false, error: 'missing_sessionId' });
        updateSession(sessionId, { expectedContext: null, lastRestaurant: null, pendingOrder: null, last_restaurants_list: null });
        res.json({ ok: true, cleared: true, session: getSession(sessionId) });
      } catch (e) {
        console.error('reset error', e);
        res.status(500).json({ ok: false, error: e.message });
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

// Brain stats (lekki endpoint do testów)
app.get('/api/brain/stats', async (req, res) => {
  try {
    const ctx = await import('./brain/context.js');
    const getSessionsCount = ctx.getSessionsCount || (() => null);
    const count = typeof getSessionsCount === 'function' ? getSessionsCount() : null;
    res.json({ ok: true, sessions: count, timestamp: Date.now() });
  } catch (e) {
    res.json({ ok: true, sessions: null, note: 'stats minimal' });
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

// --- KEEP ALIVE FOR LOCAL DEV ---
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🧠 FreeFlow Brain running locally on http://localhost:${PORT}`);
  });
}

// 404 handler (Express 5 style)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

