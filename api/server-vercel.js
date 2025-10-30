// --- FreeFlow Serverless Adapter for Vercel ---
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';

// --- App setup ---
const app = express();
app.use(express.json());
// CORS (tuż po dotenv.config): prod = Vercel, dev = localhost:5173
const CORS_ORIGINS_PROD = [
  'https://freeflow-frontend-seven.vercel.app',
  'https://freeflow-frontend.vercel.app'
];
const CORS_ORIGINS_DEV = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? CORS_ORIGINS_PROD
  : [...CORS_ORIGINS_PROD, ...CORS_ORIGINS_DEV];
app.use(cors({ origin: ALLOWED_ORIGINS, methods: ['GET','POST','OPTIONS'], credentials: true }));
// Express 5: '*' nie jest wspierane przez path-to-regexp; użyj wyrażenia regularnego lub usuń preflight handler
app.options(/.*/, cors({ origin: ALLOWED_ORIGINS }));
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

// === ADMIN ENDPOINTS ===
app.get('/api/admin/users-count', async (req, res) => {
  try {
    const mod = await import('./admin/users-count.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/partners-count', async (req, res) => {
  try {
    const mod = await import('./admin/partners-count.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/backup', async (req, res) => {
  try {
    const mod = await import('./admin/backup.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/admin/tts', async (req, res) => {
  try {
    const mod = await import('./admin/tts.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// === LOGS ===
app.get('/api/logs', async (req, res) => {
  try {
    const mod = await import('./logs.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
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

// === PING (keep-alive) ===
app.get('/api/ping', async (req, res) => {
  try {
    const ping = await import('./ping.js');
    return ping.default(req, res);
  } catch (err) {
    const now = new Date().toISOString();
    console.log(`[PING] fallback at ${now}`);
    return res.status(200).json({ ok: true, message: 'keep-alive pong 🧠', timestamp: now });
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

// --- KeepAlive (prod only) ---
import "./utils/keepAlive.js";

