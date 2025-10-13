import { applyCORS } from "./_cors.js";
import { supabase } from "../lib/supabaseClient.js";

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { error } = await supabase.from("restaurants").select("id").limit(1);
    res.status(200).json({
      ok: true,
      service: "FreeFlow Voice Expert",
      supabase: { ok: !error },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}