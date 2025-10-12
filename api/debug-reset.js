import { sessions } from "../core/sessionStore.js";

export default async function handler(req, res) {
  try {
    const { sessionId = "default" } = req.query;
    delete sessions[sessionId];
    res.json({ ok: true, message: `Session '${sessionId}' reset.` });
  } catch (err) {
    res.status(500).json({ error: "Reset error", details: err.message });
  }
}


