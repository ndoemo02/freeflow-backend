import { applyCORS } from "./_cors.js";

export default async function handler(req, res) {
  if (applyCORS(res)) return; // 👈 ważne: obsługuje preflight
  
  return res.status(200).json({
    ok: true,
    ts: new Date().toISOString()
  });
}
