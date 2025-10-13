import { supabase } from '../lib/supabaseClient.js';

function normalize(text) {
  return text.toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/g, '').trim();
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  a = normalize(a);
  b = normalize(b);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const dist = levenshtein(a, b);
  return dist <= 2;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export async function detectIntent(text) {
  if (!text) return { intent: 'none', restaurant: null };

  const lower = normalize(text);
  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name, address, lat, lng');

  const matched = restaurants?.find(r => fuzzyMatch(lower, r.name));
  if (matched) {
    return { intent: 'select_restaurant', restaurant: matched };
  }

  const findNearbyKeywords = [
    'zjeść', 'restaurac', 'pizza', 'kebab', 'burger', 'zjeść coś', 'gdzie',
    'w okolicy', 'blisko', 'zamówić', 'coś do jedzenia', 'posiłek', 'obiad',
    'gdzie zjem', 'co polecasz'
  ];

  const { data: learned } = await supabase
    .from('phrases')
    .select('text, intent');

  const learnedNearby = learned?.filter(p => p.intent === 'find_nearby') || [];
  const dynamicKeywords = learnedNearby.map(p => normalize(p.text));
  const allKeywords = [...findNearbyKeywords, ...dynamicKeywords];

  if (allKeywords.some(k => lower.includes(k))) {
    return { intent: 'find_nearby', restaurant: null };
  }

  // Jeśli Amber nie zna frazy — zapisuje ją do bazy do przyszłego uczenia
  try {
    await supabase.from('phrases').insert({ text: text, intent: 'none' });
  } catch (err) {
    console.warn('Phrase insert skipped:', err.message);
  }

  return { intent: 'none', restaurant: null };
}

export async function trainIntent(phrase, correctIntent) {
  const normalized = normalize(phrase);
  const { data: existing } = await supabase
    .from('phrases')
    .select('id, text, intent');

  const already = existing?.find(p => fuzzyMatch(normalized, p.text));
  if (already) {
    await supabase.from('phrases').update({ intent: correctIntent }).eq('id', already.id);
  } else {
    await supabase.from('phrases').insert({ text: phrase, intent: correctIntent });
  }
}