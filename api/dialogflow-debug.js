export default async function handler(req, res) {
  try {
    console.log("🧠 Debug Webhook hit:", req.method);
    const raw = await req.text();
    console.log("📦 Raw body:", raw);

    return res.status(200).json({
      message: "OK",
      method: req.method,
      rawBody: raw,
    });
  } catch (err) {
    console.error("❌ Debug error:", err);
    return res.status(500).json({ error: err.message });
  }
}
