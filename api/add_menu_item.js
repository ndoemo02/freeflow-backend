import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // uwaga, nie publiczny key!
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { restaurant_id, name, description, price, category, image_url } = req.body;

    const { data, error } = await supabase
      .from('menu_items')
      .insert([
        {
          restaurant_id,
          name,
          description,
          price,
          category,
          image_url
        }
      ])
      .select();

    if (error) throw error;

    res.status(200).json({ message: '✅ Dodano do menu', data });
  } catch (err) {
    console.error('❌ Błąd dodawania do menu:', err);
    res.status(500).json({ error: err.message });
  }
}
