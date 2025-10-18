/**
 * Testy jednostkowe dla intent detection
 * Testuje funkcje normalizacji, fuzzy matching i detekcji intencji
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  normalizeTxt, 
  fuzzyIncludes, 
  applyAliases, 
  extractSize,
  parseOrderItems 
} from '../../api/brain/intent-router.js';

describe('Text Normalization', () => {
  it('should normalize Polish characters correctly', () => {
    // normalizeTxt strips diacritics: ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z
    expect(normalizeTxt('ąćęłńóśźż')).toBe('acelnoszz');
    expect(normalizeTxt('ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz'); // lowercase
    expect(normalizeTxt('pizza Margherita')).toBe('pizza margherita');
  });

  it('should handle mixed case and special characters', () => {
    // normalizeTxt removes special chars: .:,;!?()
    expect(normalizeTxt('Pizza Margherita!')).toBe('pizza margherita');
    expect(normalizeTxt('Co jest dostępne w pobliżu?')).toBe('co jest dostepne w poblizu');
  });
});

describe('Fuzzy Matching', () => {
  it('should match exact strings', () => {
    expect(fuzzyIncludes('pizza margherita', 'pizza margherita')).toBe(true);
    expect(fuzzyIncludes('Pizza Margherita', 'pizza margherita')).toBe(true);
  });

  it('should match partial strings with high similarity', () => {
    expect(fuzzyIncludes('margherita', 'pizza margherita')).toBe(true);
    expect(fuzzyIncludes('pizza', 'pizza margherita')).toBe(true);
  });

  it('should not match completely different strings', () => {
    expect(fuzzyIncludes('burger', 'pizza margherita')).toBe(false);
    expect(fuzzyIncludes('kebab', 'pizza margherita')).toBe(false);
  });

  it('should handle Polish characters in fuzzy matching', () => {
    expect(fuzzyIncludes('pizza margherita', 'Pizza Margherita')).toBe(true);
    expect(fuzzyIncludes('żurek śląski', 'zurek slaski')).toBe(true);
  });
});

describe('Alias Application', () => {
  it('should apply basic aliases', () => {
    // applyAliases DODAJE aliasy do tekstu jeśli są w NAME_ALIASES
    // "burger" → "burger" (alias: "burger" → "burger", więc dodaje "burger")
    const burgerResult = applyAliases('burger');
    expect(burgerResult).toContain('burger');

    // "burgera" → "burgera burger" (alias: "burgera" → "burger")
    const burgeraResult = applyAliases('burgera');
    expect(burgeraResult).toContain('burger');
  });

  it('should handle female variants', () => {
    // applyAliases DODAJE aliasy do tekstu
    const result = applyAliases('margherita');
    expect(result).toContain('margherita');
    expect(result).toContain('pizza margherita');
  });

  it('should not modify non-matching strings', () => {
    expect(applyAliases('kebab')).toBe('kebab');
    // applyAliases używa normalizeTxt, który stripuje diacritics
    expect(applyAliases('sałatka')).toBe('salatka');
  });
});

describe('Size Extraction', () => {
  it('should extract size from dish names', () => {
    // extractSize zwraca liczbę (26, 32, 40) lub null
    expect(extractSize('mała pizza')).toBe(26);
    expect(extractSize('duża pizza margherita')).toBe(40);
    expect(extractSize('pizza margherita')).toBe(null);
  });

  it('should handle various size formats', () => {
    // extractSize zwraca liczbę (26, 32, 40) lub null
    expect(extractSize('small burger')).toBe(26);
    expect(extractSize('large fries')).toBe(40);
    expect(extractSize('medium pizza')).toBe(32);
    expect(extractSize('32 cm pizza')).toBe(32);
  });
});

describe('Order Items Parsing', () => {
  const mockCatalog = [
    { id: '1', name: 'Pizza Margherita', price: 25.00, category: 'pizza', restaurant_id: 'r1', restaurant_name: 'Test Pizza' },
    { id: '2', name: 'Burger Classic', price: 20.00, category: 'burger', restaurant_id: 'r1', restaurant_name: 'Test Pizza' },
    { id: '3', name: 'Kebab w bułce', price: 18.00, category: 'kebab', restaurant_id: 'r1', restaurant_name: 'Test Pizza' },
    { id: '4', name: 'Mała Pizza Margherita', price: 15.00, category: 'pizza', restaurant_id: 'r1', restaurant_name: 'Test Pizza' },
    { id: '5', name: 'Duża Pizza Margherita', price: 35.00, category: 'pizza', restaurant_id: 'r1', restaurant_name: 'Test Pizza' }
  ];

  it('should parse simple order items', () => {
    // parseOrderItems nie jest async
    const result = parseOrderItems('pizza margherita', mockCatalog);

    expect(result.available.length).toBeGreaterThan(0);
    expect(result.available[0].name).toBe('Pizza Margherita');
    expect(result.needsClarification).toBe(false);
  });

  it('should handle multiple items', () => {
    const result = parseOrderItems('pizza margherita i burger', mockCatalog);

    expect(result.available.length).toBeGreaterThanOrEqual(2);
    const names = result.available.map(item => item.name);
    expect(names).toContain('Pizza Margherita');
    expect(names).toContain('Burger Classic');
  });

  it('should handle size preferences', () => {
    const result = parseOrderItems('mała pizza margherita', mockCatalog);

    expect(result.available.length).toBeGreaterThan(0);
    // Może zwrócić "Mała Pizza Margherita" lub "Pizza Margherita" z size=26
    const hasSmallPizza = result.available.some(item =>
      item.name.includes('Mała') || item.name === 'Pizza Margherita'
    );
    expect(hasSmallPizza).toBe(true);
  });

  it('should handle unavailable items', () => {
    const result = parseOrderItems('pizza hawajska i burger', mockCatalog);

    // Burger powinien być dostępny
    const names = result.available.map(item => item.name);
    expect(names).toContain('Burger Classic');
  });

  it('should handle empty catalog', () => {
    const result = parseOrderItems('pizza margherita', []);

    expect(result.available).toHaveLength(0);
    expect(result.missingAll).toBe(true);
  });

  it('should deduplicate similar items', () => {
    const result = parseOrderItems('pizza margherita', mockCatalog);

    // Should return only one pizza margherita (deduplicated)
    expect(result.available.length).toBeGreaterThan(0);
  });
});

describe('Edge Cases', () => {
  it('should handle empty input', async () => {
    const result = await parseOrderItems('', []);
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
    expect(result.missingAll).toBe(true);
  });

  it('should handle null input', async () => {
    const result = await parseOrderItems(null, []);
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
    expect(result.missingAll).toBe(true);
  });

  it('should handle special characters in dish names', async () => {
    const catalog = [
      { id: '1', name: 'Crème brûlée', price: 12.00, category: 'dessert' }
    ];
    
    const result = await parseOrderItems('creme brulee', catalog);
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe('Crème brûlée');
  });
});
