// api/brain/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) console.error("❌ Missing SUPABASE_URL environment variable");
if (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)
  console.error("❌ Missing SUPABASE keys (anon or service role)");

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

// --- Połączenie sanity check ---
export async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase.from("restaurants").select("id").limit(1);
    if (error) throw error;
    console.log("✅ Supabase connection OK");
    return true;
  } catch (err) {
    console.error("❌ Supabase connection FAILED:", err.message);
    return false;
  }
}
