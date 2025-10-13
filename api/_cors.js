// api/_cors.js

export const ALLOWED_ORIGINS = [
  "https://freeflow-frontend-seven.vercel.app",
  "https://freeflow-backend.vercel.app",
  "http://localhost:5173",
];

export const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Origin",
  "User-Agent",
  "Referer",
  "Accept-Encoding",
  "Accept-Language",
].join(",");

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));
}

export function applyCORS(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
