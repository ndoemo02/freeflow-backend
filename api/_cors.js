export function applyCORS(req, res) {
  const allowedOrigins = [
    "https://freeflow-frontend-seven.vercel.app",
    "https://freeflow-frontend.vercel.app",
    "http://localhost:5173",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null
  ].filter(Boolean);

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // domyślnie odrzuć, ale loguj do konsoli
    console.warn(`🚫 CORS BLOCKED ORIGIN: ${origin}`);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}