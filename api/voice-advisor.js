import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { text } = req.body;

  const { data: menu } = await supabase.from('menu_items').select('*').limit(5);
  const list = menu?.map(m => `${m.name} (${m.price} zł)`).join(', ');

  const prompt = `Użytkownik pyta: "${text}". 
  Odpowiedz jako doradca restauracyjny FreeFlow, po polsku. 
  Aktualne menu: ${list}.`;

  const ai = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: prompt }]
  });

  res.json({ reply: ai.choices[0].message.content });
}
