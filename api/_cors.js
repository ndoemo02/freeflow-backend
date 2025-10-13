// api/_cors.js

const STATIC_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://freeflow-frontend-seven.vercel.app"
]);

export const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "apikey",
  "X-Client-Info",
  "X-Requested-With"
];

const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];

export function isAllowedOrigin(origin = "") {
  if (!origin) return false;

  if (STATIC_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  try {
    const { hostname, protocol } = new URL(origin);

    // Allow Vercel preview deployments for the frontend project
    return (
      ["http:", "https:"].includes(protocol) &&
      hostname.endsWith(".vercel.app") &&
      hostname.startsWith("freeflow-frontend")
    );
  } catch {
    return false;
  }
}

export function applyCORS(req, res) {
  try {
    const origin = req.headers.origin;
    const isAllowed = isAllowedOrigin(origin);

    if (!origin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Credentials", "false");
    } else if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      console.warn(`🚨 CORS blocked origin: ${origin}`);
      res.status(403).json({ ok: false, error: "CORS origin not allowed" });
      return true;
    }

    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(","));
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(","));

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return true;
    }

    return false;
  } catch (err) {
    console.error("CORS setup error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Credentials", "false");
    return false;
  }
}
