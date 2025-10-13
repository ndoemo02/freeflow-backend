// Amber Brain - uses internal API endpoints for restaurant data

// --- NATURALNE FORMATOWANIE DYSTANSU ---
const formatDistance = (distKm) => {
  const distMeters = distKm * 1000;

  if (distMeters < 100) {
    return `${Math.round(distMeters)} metrów`; // np. 72 m
  } else if (distMeters < 500) {
    return `${Math.round(distMeters / 10) * 10} metrów`; // zaokrąglenie do 10 m
  } else if (distMeters < 1000) {
    return `${Math.round(distMeters / 10) * 10} metrów`; // np. 720 m
  } else if (distMeters < 2000) {
    const km = (distMeters / 1000).toFixed(1).replace('.', ',');
    return `${km} kilometra`; // np. 1,2 kilometra
  } else {
    const km = Math.round(distMeters / 1000);
    return `${km} kilometrów`; // np. 2 km
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
      // --- GENEROWANIE LISTY ---
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