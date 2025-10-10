import express from "express";
import cors from "cors";

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
  optionsSuccessStatus: 200
}));

app.use(express.json());

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Simple brain endpoint
app.post("/api/brain", (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://freeflow-frontend-seven.vercel.app',
    'https://freeflow-frontend.vercel.app', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { text, sessionId, userId } = req.body;

    if (!text) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing text parameter" 
      });
    }

    console.log("🧠 FreeFlow Brain processing:", { text, sessionId, userId });

    // Simple response
    const reply = "Cześć! Jestem FreeFlow - pomogę Ci zamówić jedzenie, taksówkę lub hotel. Co Cię interesuje?";

    console.log("🧠 FreeFlow Brain response:", reply);

    return res.status(200).json({
      ok: true,
      response: reply,
      sessionId: sessionId || 'default',
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ FreeFlow brain error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FreeFlow Backend działa na porcie ${PORT}`));
