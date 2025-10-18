// /api/brain/helpers.js - Shared helper functions for brain router
// Consolidated utilities to eliminate duplication

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

export function stripDiacritics(s = '') {
  if (!s) return '';
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

export function normalize(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9 ]/g, '')
    .trim();
}

export function normalizeTxt(s = '') {
  if (!s) return '';
  return stripDiacritics(s.toLowerCase())
    .replace(/[-_]/g, ' ')
    .replace(/[„"'"'.:,;!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// FUZZY MATCHING
// ============================================================================

export function levenshtein(a, b) {
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

export function fuzzyMatch(a, b, threshold = 3) {
  if (!a || !b) return false;
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  if (normA.split(' ')[0] === normB.split(' ')[0]) return true;
  const dist = levenshtein(normA, normB);
  return dist <= threshold;
}

export function fuzzyIncludes(name, text) {
  if (!name || !text) return false;
  const n = normalizeTxt(name);
  const t = normalizeTxt(text);
  if (t.includes(n)) return true;
  
  const toks = n.split(' ').filter(Boolean);
  const long = toks.filter(tok => tok.length > 2);
  const hits = long.filter(tok => t.includes(tok));
  
  if (long.length <= 1) return hits.length >= 1;
  return hits.length / long.length >= 0.6;
}

// ============================================================================
// QUANTITY & SIZE EXTRACTION
// ============================================================================

const QTY_WORDS = {
  'jedno': 1, 'jedna': 1, 'jeden': 1,
  'dwa': 2, 'dwie': 2, 'dwóch': 2,
  'trzy': 3, 'trzech': 3,
  'cztery': 4, 'czterech': 4,
  'pięć': 5, 'pięciu': 5,
  'sześć': 6, 'sześciu': 6,
  'siedem': 7, 'siedmiu': 7,
  'osiem': 8, 'ośmiu': 8,
  'dziewięć': 9, 'dziewięciu': 9,
  'dziesięć': 10, 'dziesięciu': 10,
  'kilka': 2, 'kilku': 2, 'parę': 2
};

export function extractQuantity(text) {
  if (!text) return 1;
  const normalized = normalizeTxt(text);
  
  // Pattern 1: Numbers (2x, 3x, 2 razy)
  const numPattern = /(\d+)\s*(?:x|razy|sztuk|porcj)/i;
  const numMatch = normalized.match(numPattern);
  if (numMatch) return parseInt(numMatch[1], 10);
  
  // Pattern 2: Word form
  for (const [word, qty] of Object.entries(QTY_WORDS)) {
    if (normalized.includes(word)) return qty;
  }
  
  return 1;
}

export function extractSize(text = '') {
  if (!text) return null;
  const s = normalizeTxt(text);
  
  const m = s.match(/\b(26|28|30|31|32|40)\s*(cm)?\b/);
  if (m) return parseInt(m[1], 10);
  
  if (/\b(mala|mała|small)\b/.test(s)) return 26;
  if (/\b(srednia|średnia|medium)\b/.test(s)) return 32;
  if (/\b(duza|duża|large)\b/.test(s)) return 40;
  
  return null;
}

// ============================================================================
// LOCATION & CUISINE EXTRACTION
// ============================================================================

export function extractLocation(text) {
  const locationKeywords = ['w', 'na', 'blisko', 'koło', 'niedaleko', 'obok', 'przy'];
  const pattern = new RegExp(`(?:${locationKeywords.join('|')})\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)?)`, 'i');
  const match = text.match(pattern);
  
  if (match) {
    let location = match[1]?.trim();
    const blacklist = ['tutaj', 'tu', 'szybko', 'pobliżu', 'okolicy', 'menu', 'coś', 'cos', 'azjatyckiego', 'azjatyckie', 'szybkiego', 'dobrego', 'innego'];
    const locationLower = location.toLowerCase();
    
    if (blacklist.includes(locationLower) || blacklist.some(word => locationLower.startsWith(word + ' '))) {
      return null;
    }
    
    // Normalize case endings
    location = location
      .replace(/ach$/i, 'y')
      .replace(/iu$/i, '')
      .replace(/ie$/i, 'a')
      .replace(/ami$/i, 'a');
    
    return location;
  }
  
  return null;
}

const CUISINE_MAP = {
  'pizza': 'Pizzeria', 'pizze': 'Pizzeria', 'pizzy': 'Pizzeria', 'pizzeria': 'Pizzeria',
  'kebab': 'Kebab', 'kebaba': 'Kebab', 'kebabu': 'Kebab',
  'burger': 'Amerykańska', 'burgera': 'Amerykańska', 'burgery': 'Amerykańska',
  'wloska': 'Włoska', 'wloskiej': 'Włoska',
  'polska': 'Polska', 'polskiej': 'Polska',
  'wietnamska': 'Wietnamska', 'wietnamskiej': 'Wietnamska',
  'chinska': 'Chińska', 'chinskiej': 'Chińska',
  'tajska': 'Tajska', 'tajskiej': 'Tajska',
  'azjatyckie': 'azjatyckie', 'azjatyckiej': 'azjatyckiej',
  'fastfood': 'fastfood', 'fast food': 'fast food',
  'lokalne': 'lokalne', 'lokalnej': 'lokalnej',
  'wege': 'wege', 'wegetarianskie': 'wege'
};

export function extractCuisineType(text) {
  const normalized = normalize(text);
  for (const [keyword, cuisineType] of Object.entries(CUISINE_MAP)) {
    if (normalized.includes(keyword)) return cuisineType;
  }
  return null;
}

// ============================================================================
// DISTANCE CALCULATION
// ============================================================================

export function calculateDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

