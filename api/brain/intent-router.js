import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9 ]/g, '')
    .trim();
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  a = normalize(a);
  b = normalize(b);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Minimalne dopasowanie (Levenshtein)
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

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name, address, lat, lng');

  const lower = normalize(text);

  const matched = restaurants?.find(r => fuzzyMatch(lower, r.name));

  if (matched) {
    return {
      intent: 'select_restaurant',
      restaurant: matched,
    };
  }

  if (lower.includes('zjeść') || lower.includes('restaurac') || lower.includes('pizza')) {
    return { intent: 'find_nearby', restaurant: null };
  }

  return { intent: 'none', restaurant: null };
}