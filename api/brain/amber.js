// Amber Brain - uses internal API endpoints for restaurant data

const formatDistance = (distKm) => {
  if (distKm < 0.1) {
    // mniej niż 100 m
    return `${Math.round(distKm * 1000)} metrów`;
  } else if (distKm < 1) {
    // np. 0.25 km → "250 metrów"
    return `${Math.round(distKm * 1000)} metrów`;
  } else {
    // np. 1.5 km → "1.5 kilometra"
    return `${distKm.toFixed(1)} kilometra`;
  }
};

export default async function amberBrain(req, res) {
  try {
    const { text, lat, lng } = req.body;

    if (!text) return res.status(400).json({ error: "Missing text input" });

    // 1️⃣ Jeśli mamy współrzędne, używamy ich do dopasowania najbliższych lokali
    let nearby = [];
    if (lat && lng) {
      // ✅ Użyj lokalnego endpointu z filtrowaniem dystansu
      const nearbyRes = await fetch(
        `http://localhost:3000/api/restaurants/nearby?lat=${lat}&lng=${lng}&radius=2`
      );
      const { nearby: nearbyData } = await nearbyRes.json();
      nearby = nearbyData || [];
    }

    // 2️⃣ Tworzymy logiczną odpowiedź
    let reply = "Nie mam danych o restauracjach w pobliżu.";
    if (nearby && nearby.length > 0) {
      const listText = nearby
        .slice(0, 5)
        .map(
          (r, i) =>
            `${i + 1}. ${r.name} (${formatDistance(r.distance_km)}, ${r.address})`
        )
        .join("\n");

      reply = `Oto restauracje w promieniu 2 kilometrów:\n${listText}\nKtórą chcesz wybrać?`;
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