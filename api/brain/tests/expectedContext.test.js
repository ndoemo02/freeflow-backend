// /api/brain/tests/expectedContext.test.js
// Specjalizowane testy dla expectedContext flow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boostIntent } from '../brainRouter.js';
import { updateSession, getSession } from '../context.js';

describe('🧠 ExpectedContext Flow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('📋 Show More Options Flow', () => {
    it('should detect "pokaż więcej opcji" with show_more_options context', () => {
      const session = {
        expectedContext: 'show_more_options',
        last_restaurants_list: [
          { name: 'Restaurant 1' },
          { name: 'Restaurant 2' },
          { name: 'Restaurant 3' }
        ]
      };

      const testCases = [
        'pokaż więcej opcji',
        'pokaż więcej',
        'pokaż wszystkie',
        'pokaż pozostałe',
        'pokaż resztę',
        'więcej opcji'
      ];

      testCases.forEach(text => {
        const result = boostIntent(text, 'none', 0.3, session);
        expect(result).toBe('show_more_options');
      });
    });

    it('should NOT detect "pokaż więcej" without expectedContext', () => {
      const session = {
        expectedContext: null,
        last_restaurants_list: []
      };

      const result = boostIntent('pokaż więcej opcji', 'none', 0.3, session);
      expect(result).toBe('none'); // Nie zmienia intencji
    });
  });

  describe('✅ Confirm Order Flow', () => {
    it('should detect confirmation with confirm_order context', () => {
      const session = {
        expectedContext: 'confirm_order',
        pendingOrder: {
          restaurant: { name: 'Test Restaurant' },
          items: [{ name: 'Pizza', price: 25, quantity: 1 }],
          total: 25
        }
      };

      const confirmCases = [
        'tak',
        'ok',
        'dobrze',
        'zgoda',
        'pewnie',
        'jasne',
        'oczywiście',
        'dodaj',
        'dodaj proszę',
        'zamów',
        'zamawiam',
        'potwierdzam'
      ];

      confirmCases.forEach(text => {
        const result = boostIntent(text, 'none', 0.3, session);
        expect(result).toBe('confirm_order');
      });
    });

    it('should detect cancellation with confirm_order context', () => {
      const session = {
        expectedContext: 'confirm_order',
        pendingOrder: {
          restaurant: { name: 'Test Restaurant' },
          items: [{ name: 'Pizza', price: 25, quantity: 1 }],
          total: 25
        }
      };

      const cancelCases = [
        'nie',
        'anuluj',
        'rezygnuję',
        'nie chcę',
        'nie teraz',
        'nie zamawiaj'
      ];

      cancelCases.forEach(text => {
        const result = boostIntent(text, 'none', 0.3, session);
        expect(result).toBe('cancel_order');
      });
    });
  });

  describe('🎯 Select Restaurant Flow', () => {
    it('should detect restaurant selection with select_restaurant context', () => {
      const session = {
        expectedContext: 'select_restaurant',
        last_restaurants_list: [
          { name: 'Restaurant 1' },
          { name: 'Restaurant 2' },
          { name: 'Restaurant 3' }
        ]
      };

      const selectCases = [
        'wybieram',
        'wybierz',
        'ta pierwsza',
        'ta druga',
        'ta trzecia',
        'numer 1',
        'numer 2',
        'numer 3',
        '1',
        '2',
        '3'
      ];

      selectCases.forEach(text => {
        const result = boostIntent(text, 'none', 0.3, session);
        expect(result).toBe('select_restaurant');
      });
    });
  });

  describe('🔄 Context Priority Tests', () => {
    it('should prioritize expectedContext over other semantic rules', () => {
      const session = {
        expectedContext: 'confirm_order',
        pendingOrder: { restaurant: { name: 'Test' }, items: [], total: 0 }
      };

      // Tekst zawiera "nie" ale expectedContext to "confirm_order"
      const result = boostIntent('nie chcę tego', 'none', 0.3, session);
      expect(result).toBe('cancel_order'); // "nie" w kontekście confirm_order = cancel_order
    });

    it('should skip boost if confidence is high', () => {
      const session = {
        expectedContext: 'confirm_order',
        pendingOrder: { restaurant: { name: 'Test' }, items: [], total: 0 }
      };

      const result = boostIntent('tak', 'menu_request', 0.9, session);
      expect(result).toBe('menu_request'); // Nie zmienia bo confidence >= 0.8
    });

    it('should handle missing expectedContext gracefully', () => {
      const session = {
        expectedContext: null,
        lastRestaurant: { name: 'Test Restaurant' }
      };

      const result = boostIntent('tak', 'none', 0.3, session);
      expect(result).toBe('confirm'); // Fallback to general confirm
    });
  });

  describe('🧪 Session State Tests', () => {
    it('should preserve session state during expectedContext flow', () => {
      const sessionId = 'test-session';
      
      // Ustaw początkową sesję
      updateSession(sessionId, {
        lastIntent: 'find_nearby',
        lastRestaurant: { name: 'Original Restaurant' },
        last_location: 'Piekary Śląskie'
      });

      // Ustaw expectedContext
      updateSession(sessionId, {
        expectedContext: 'show_more_options',
        last_restaurants_list: [
          { name: 'Restaurant 1' },
          { name: 'Restaurant 2' }
        ]
      });

      const session = getSession(sessionId);
      
      // Sprawdź czy dane zostały zachowane
      expect(session.lastIntent).toBe('find_nearby');
      expect(session.lastRestaurant.name).toBe('Original Restaurant');
      expect(session.last_location).toBe('Piekary Śląskie');
      expect(session.expectedContext).toBe('show_more_options');
      expect(session.last_restaurants_list).toHaveLength(2);
    });

    it('should clear expectedContext after handling', () => {
      const sessionId = 'test-session';
      
      // Ustaw expectedContext
      updateSession(sessionId, {
        expectedContext: 'confirm_order',
        pendingOrder: { restaurant: { name: 'Test' }, items: [], total: 0 }
      });

      // Symuluj obsługę (w prawdziwym kodzie to robi brainRouter)
      updateSession(sessionId, {
        expectedContext: null,
        pendingOrder: null
      });

      const session = getSession(sessionId);
      expect(session.expectedContext).toBeNull();
      expect(session.pendingOrder).toBeNull();
    });
  });

  describe('🎭 Edge Cases', () => {
    it('should handle malformed expectedContext', () => {
      const session = {
        expectedContext: 'invalid_context',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      const result = boostIntent('tak', 'none', 0.3, session);
      expect(result).toBe('confirm'); // Fallback to general confirm
    });

    it('should handle empty expectedContext', () => {
      const session = {
        expectedContext: '',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      const result = boostIntent('tak', 'none', 0.3, session);
      expect(result).toBe('confirm'); // Fallback to general confirm
    });

    it('should handle undefined session', () => {
      const result = boostIntent('tak', 'none', 0.3, undefined);
      expect(result).toBe('confirm'); // Fallback to general confirm
    });

    it('should handle null session', () => {
      const result = boostIntent('tak', 'none', 0.3, null);
      expect(result).toBe('confirm'); // Fallback to general confirm
    });
  });
});


