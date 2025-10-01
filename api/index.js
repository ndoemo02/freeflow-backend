export default function handler(req, res) {
  if (req.url === "/api/health") {
    return res.status(200).json({ ok: true });
  }
  return res.status(404).json({ error: "Not found", path: req.url });
}
