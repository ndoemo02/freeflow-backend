import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function amberBrain(req, res) {
  try {
    const { text, lat, lng } = req.body;

    if (!text) return res.status(400).json({ error: "Missing text input" });

    // 1️⃣ Jeśli mamy współrzędne, używamy ich do dopasowania najbliższych lokali
    let nearby = [];
    if (lat && lng) {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, address, lat, lng");

      if (error) throw error;

      nearby = data
        .map((r) => ({
          ...r,
          distance_km: calculateDistance(lat, lng, r.lat, r.lng),
        }))
        .filter((r) => r.distance_km <= 3)
        .sort((a, b) => a.distance_km - b.distance_km);
    }

    // 2️⃣ Tworzymy logiczną odpowiedź
    let reply = "Nie mam danych o restauracjach w pobliżu.";
    if (nearby.length > 0) {
      const lines = nearby
        .slice(0, 5)
        .map(
          (r, i) =>
            `${i + 1}. ${r.name} (${r.distance_km.toFixed(2)} km, ${r.address})`
        )
        .join("\n");

      reply = `Oto restauracje w promieniu 3 kilometrów:\n${lines}\nKtórą chcesz wybrać?`;
    }

    console.log("🧠 Amber response:", reply);
    res.json({
      ok: true,
      reply,
      count: nearby.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Amber brain error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
}