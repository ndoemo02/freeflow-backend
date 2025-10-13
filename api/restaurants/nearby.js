import express from "express";
import { supabase } from "../../lib/supabaseClient.js";

const router = express.Router();

// Funkcja licząca dystans między punktami (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Endpoint: /api/restaurants/nearby?lat=50.3859&lng=18.9461&radius=2
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lng, radius = 2 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat/lng parameters" });
    }

    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");

    if (error) throw error;

    const nearby = restaurants
      .map((r) => ({
        ...r,
        distance_km: calculateDistance(lat, lng, r.lat, r.lng),
      }))
      .filter((r) => r.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({ nearby });
  } catch (err) {
    console.error("Nearby error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
