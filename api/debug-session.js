import { sessions } from "../core/sessionStore.js";

export default async function handler(req, res) {
  try {
    const { sessionId = "default" } = req.query;
    const session = sessions[sessionId];
    if (!session) return res.status(404).json({ error: "Session not found", sessionId });

    res.json({
      ok: true,
      sessionId,
      currentRestaurant: session.currentRestaurant,
      historyLength: session.history.length,
      history: session.history,
    });
  } catch (err) {
    res.status(500).json({ error: "Debug error", details: err.message });
  }
}
