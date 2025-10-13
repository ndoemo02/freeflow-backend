// api/_cors.js
export function applyCORS(req, res) {
  try {
    const origin = req.headers.origin || "*";

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    // 👇 krytyczny fallback dla Vercel nested requests
    if (!res.getHeader("Access-Control-Allow-Origin")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return true;
    }

    return false;
  } catch (err) {
    console.error("CORS setup error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return false;
  }
}