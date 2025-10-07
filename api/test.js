import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data, error } = await supabase
      .from("restaurants")
      .select("id,name")
      .limit(3);

    if (error) throw error;

    res.status(200).json({
      ok: true,
      connected: true,
      sample: data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}