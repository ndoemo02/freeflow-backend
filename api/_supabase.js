// api/_supabase.js
import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('[Supabase] Missing envs: SUPABASE_URL and/or SUPABASE_*_KEY');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
