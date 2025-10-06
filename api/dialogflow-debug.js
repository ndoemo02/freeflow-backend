export default async function handler(req, res) {
  try {
    console.log("🧠 Debug Webhook hit:", req.method);
    console.log("📦 Raw body:", JSON.stringify(req.body, null, 2));
    console.log("📦 Body type:", typeof req.body);

    return res.status(200).json({
      message: "OK",
      method: req.method,
      body: req.body,
      bodyType: typeof req.body,
    });
  } catch (err) {
    console.error("❌ Debug error:", err);
    return res.status(500).json({ error: err.message });
  }
}
