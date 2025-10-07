import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase.from('restaurants').select('id').limit(1);
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      message: '✅ Supabase connection works!',
      sample: data,
    });
  } catch (err) {
    console.error('❌ Supabase test error:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
