// /api/brain/tests/brainRouter.test.js
// Testy jednostkowe dla brainRouter.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSession, updateSession } from '../context.js';
import { boostIntent } from '../brainRouter.js';
import { detectIntent, applyAliases } from '../intent-router.js';

// Mock Supabase
vi.mock('../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            data: [],
            error: null
          }))
        })),
        limit: vi.fn(() => ({
          data: [],
          error: null
        }))
      })),
      insert: vi.fn(() => ({
        data: null,
        error: null
      }))
    }))
  }
}));

// Mock OpenAI
global.fetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({
      choices: [{
        message: {
          content: 'Test response from Amber'
        }
      }]
    })
  })
);

describe('🧠 BrainRouter Tests', () => {
  beforeEach(() => {
    // Wyczyść sesje przed każdym testem
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Wyczyść sesje po każdym teście
    vi.clearAllMocks();
  });

  describe('🔧 Alias Tests', () => {
    it('should map "diabolo" to "pizza diavola"', () => {
      const text = 'chcę pizzę diabolo';
      const result = applyAliases(text);
      expect(result).toContain('pizza diavola');
    });

    it('should map "diabola" to "pizza diavola"', () => {
      const text = 'zamów diabola';
      const result = applyAliases(text);
      expect(result).toContain('pizza diavola');
    });

    it('should map "pizza diabolo" to "pizza diavola"', () => {
      const text = 'pizza diabolo';
      const result = applyAliases(text);
      expect(result).toContain('pizza diavola');
    });

    it('should handle multiple aliases', () => {
      const text = 'chcę margheritę i diabolo';
      const result = applyAliases(text);
      expect(result).toContain('pizza margherita');
      expect(result).toContain('pizza diavola');
    });
  });

  describe('🧠 ExpectedContext Tests', () => {
    it('should detect "pokaż więcej opcji" with expectedContext', () => {
      const session = {
        expectedContext: 'show_more_options',
        lastRestaurant: { name: 'Test Restaurant' },
        lastIntent: 'find_nearby'
      };

      const result = boostIntent('pokaż więcej opcji', 'none', 0.3, session);
      expect(result).toBe('show_more_options');
    });

    it('should detect "tak" with confirm_order expectedContext', () => {
      const session = {
        expectedContext: 'confirm_order',
        lastRestaurant: { name: 'Test Restaurant' },
        lastIntent: 'create_order',
        pendingOrder: {
          restaurant: { name: 'Test Restaurant' },
          items: [{ name: 'Pizza', price: 25, quantity: 1 }],
          total: 25
        }
      };

      const result = boostIntent('tak', 'none', 0.3, session);
      expect(result).toBe('confirm_order');
    });

    it('should detect "nie" with confirm_order expectedContext', () => {
      const session = {
        expectedContext: 'confirm_order',
        lastRestaurant: { name: 'Test Restaurant' },
        lastIntent: 'create_order',
        pendingOrder: {
          restaurant: { name: 'Test Restaurant' },
          items: [{ name: 'Pizza', price: 25, quantity: 1 }],
          total: 25
        }
      };

      const result = boostIntent('nie', 'none', 0.3, session);
      expect(result).toBe('cancel_order');
    });

    it('should detect "wybieram pierwszą" with select_restaurant expectedContext', () => {
      const session = {
        expectedContext: 'select_restaurant',
        lastRestaurant: { name: 'Test Restaurant' },
        lastIntent: 'find_nearby',
        last_restaurants_list: [
          { name: 'Restaurant 1' },
          { name: 'Restaurant 2' }
        ]
      };

      const result = boostIntent('wybieram pierwszą', 'none', 0.3, session);
      expect(result).toBe('select_restaurant');
    });
  });

  describe('🎯 Intent Detection Tests', () => {
    it('should detect find_nearby intent', async () => {
      const result = await detectIntent('gdzie zjeść?', null);
      expect(result.intent).toBe('find_nearby');
    });

    it('should detect menu_request intent', async () => {
      const session = {
        lastRestaurant: { id: 'test-id', name: 'Test Restaurant' }
      };
      const result = await detectIntent('pokaż menu', session);
      expect(result.intent).toBe('menu_request');
    });

    it('should detect create_order intent with dish', async () => {
      const session = {
        lastRestaurant: { id: 'test-id', name: 'Test Restaurant' }
      };
      const result = await detectIntent('zamów pizzę margherita', session);
      expect(result.intent).toBe('create_order');
    });
  });

  describe('🔄 Session Management Tests', () => {
    it('should update session correctly', () => {
      const sessionId = 'test-session';
      const updates = {
        expectedContext: 'confirm_order',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      updateSession(sessionId, updates);
      const session = getSession(sessionId);
      
      expect(session.expectedContext).toBe('confirm_order');
      expect(session.lastRestaurant.name).toBe('Test Restaurant');
    });

    it('should preserve existing session data', () => {
      const sessionId = 'test-session';
      
      // Ustaw początkową sesję
      updateSession(sessionId, {
        lastIntent: 'find_nearby',
        lastRestaurant: { name: 'Original Restaurant' }
      });

      // Zaktualizuj tylko expectedContext
      updateSession(sessionId, {
        expectedContext: 'select_restaurant'
      });

      const session = getSession(sessionId);
      
      expect(session.lastIntent).toBe('find_nearby');
      expect(session.lastRestaurant.name).toBe('Original Restaurant');
      expect(session.expectedContext).toBe('select_restaurant');
    });
  });

  describe('🎭 BoostIntent Priority Tests', () => {
    it('should prioritize expectedContext over other rules', () => {
      const session = {
        expectedContext: 'confirm_order',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      // Tekst zawiera "nie" ale expectedContext to "confirm_order"
      const result = boostIntent('nie chcę tego', 'none', 0.3, session);
      expect(result).toBe('cancel_order'); // "nie" w kontekście confirm_order = cancel_order
    });

    it('should skip boost if confidence is high', () => {
      const session = {
        expectedContext: 'confirm_order',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      const result = boostIntent('tak', 'menu_request', 0.9, session);
      expect(result).toBe('menu_request'); // Nie zmienia intencji bo confidence >= 0.8
    });

    it('should handle fallback to nearby keywords', () => {
      const result = boostIntent('chcę coś zjeść', 'none', 0.3, null);
      expect(result).toBe('find_nearby');
    });
  });

  describe('🔍 Edge Cases', () => {
    it('should handle empty text', async () => {
      const result = await detectIntent('', null);
      expect(result.intent).toBe('none');
    });

    it('should handle null session', () => {
      const result = boostIntent('tak', 'none', 0.3, null);
      expect(result).toBe('confirm'); // Fallback to confirm
    });

    it('should handle malformed session', () => {
      const malformedSession = { invalid: 'data' };
      const result = boostIntent('tak', 'none', 0.3, malformedSession);
      expect(result).toBe('confirm'); // Fallback to confirm
    });
  });
});

describe('🧪 Integration Tests', () => {
  it('should handle complete "pokaż więcej opcji" flow', async () => {
    // Krok 1: Użytkownik pyta o restauracje
    const session1 = { lastIntent: 'unknown' };
    const result1 = await detectIntent('gdzie zjeść?', session1);
    expect(result1.intent).toBe('find_nearby');

    // Krok 2: System ustawia expectedContext (symulacja)
    updateSession('test-session', {
      expectedContext: 'show_more_options',
      last_restaurants_list: [
        { name: 'Restaurant 1' },
        { name: 'Restaurant 2' },
        { name: 'Restaurant 3' }
      ]
    });

    // Krok 3: Użytkownik prosi o więcej opcji
    const session2 = getSession('test-session');
    const result2 = boostIntent('pokaż więcej opcji', 'none', 0.3, session2);
    expect(result2).toBe('show_more_options');
  });

  it('should handle complete "potwierdź zamówienie" flow', async () => {
    // Krok 1: Użytkownik zamawia
    const session1 = { lastRestaurant: { id: 'test-id', name: 'Test Restaurant' } };
    const result1 = await detectIntent('zamów pizzę margherita', session1);
    expect(result1.intent).toBe('create_order');

    // Krok 2: System ustawia expectedContext (symulacja)
    updateSession('test-session', {
      expectedContext: 'confirm_order',
      pendingOrder: {
        restaurant: { name: 'Test Restaurant' },
        items: [{ name: 'Pizza Margherita', price: 25, quantity: 1 }],
        total: 25
      }
    });

    // Krok 3: Użytkownik potwierdza
    const session2 = getSession('test-session');
    const result2 = boostIntent('tak', 'none', 0.3, session2);
    expect(result2).toBe('confirm_order');
  });
});


