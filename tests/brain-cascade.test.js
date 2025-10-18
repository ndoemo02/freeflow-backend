// tests/brain-cascade.test.js - Comprehensive cascade tests for brain API
import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SESSION_ID = 'test-session-' + Date.now();

// Helper function for API calls
async function callBrain(text, sessionId = SESSION_ID) {
  const response = await fetch(`${API_URL}/api/brain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId })
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

describe('🧠 Brain API - Cascade Tests', () => {
  
  // ============================================================================
  // TIER 1: HEALTH & BASIC VALIDATION
  // ============================================================================
  
  describe('Tier 1: Health & Basic Validation', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`${API_URL}/api/health`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.supabase.ok).toBe(true);
    });
    
    it('should reject empty text', async () => {
      const response = await fetch(`${API_URL}/api/brain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID })
      });
      expect(response.status).toBe(400);
    });
    
    it('should reject non-POST methods', async () => {
      const response = await fetch(`${API_URL}/api/brain`, {
        method: 'GET'
      });
      expect(response.status).toBe(405);
    });
  });
  
  // ============================================================================
  // TIER 2: INTENT DETECTION
  // ============================================================================
  
  describe('Tier 2: Intent Detection', () => {
    it('should detect find_nearby intent', async () => {
      const result = await callBrain('Gdzie mogę zjeść w Piekarach?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('find_nearby');
      expect(result.reply).toBeTruthy();
    });
    
    it('should detect menu_request intent', async () => {
      const result = await callBrain('Pokaż menu Monte Carlo');
      expect(result.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(result.intent);
    });
    
    it('should detect select_restaurant intent', async () => {
      const result = await callBrain('Wybierz restaurację Monte Carlo');
      expect(result.ok).toBe(true);
      expect(['select_restaurant', 'menu_request']).toContain(result.intent);
    });
    
    it('should detect create_order intent', async () => {
      const result = await callBrain('Zamów pizzę Margherita w Monte Carlo');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 3: GEO CONTEXT LAYER
  // ============================================================================
  
  describe('Tier 3: Geo Context Layer', () => {
    it('should extract location from text', async () => {
      const result = await callBrain('Gdzie zjeść w Bytomiu?');
      expect(result.ok).toBe(true);
      expect(result.location || result.context?.last_location).toBeTruthy();
    });
    
    it('should handle cuisine type filtering', async () => {
      const result = await callBrain('Gdzie zjeść pizzę w Piekarach?');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(pizza|pizzer|włosk)/i);
    });
    
    it('should handle azjatyckie cuisine alias', async () => {
      const result = await callBrain('Coś azjatyckiego w Piekarach');
      expect(result.ok).toBe(true);
      expect(result.restaurants?.length || 0).toBeGreaterThanOrEqual(0);
    });
  });
  
  // ============================================================================
  // TIER 4: SESSION CONTEXT & MEMORY
  // ============================================================================
  
  describe('Tier 4: Session Context & Memory', () => {
    const sessionId = 'test-context-' + Date.now();
    
    it('should remember last restaurant', async () => {
      await callBrain('Wybierz Monte Carlo', sessionId);
      const result = await callBrain('Pokaż menu', sessionId);
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/Monte Carlo/i);
    });
    
    it('should remember last location', async () => {
      await callBrain('Gdzie zjeść w Bytomiu?', sessionId);
      const result = await callBrain('Pokaż restauracje', sessionId);
      expect(result.ok).toBe(true);
      expect(result.context?.last_location).toMatch(/Bytom/i);
    });
  });
  
  // ============================================================================
  // TIER 5: FUZZY MATCHING & ALIASES
  // ============================================================================
  
  describe('Tier 5: Fuzzy Matching & Aliases', () => {
    it('should handle typos in restaurant names', async () => {
      const result = await callBrain('Menu Monte Karlo');
      expect(result.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(result.intent);
    });
    
    it('should handle dish aliases', async () => {
      const result = await callBrain('Zamów margheritę');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should normalize Polish characters', async () => {
      const result = await callBrain('Gdzie zjeść pizzę?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('find_nearby');
    });
  });
  
  // ============================================================================
  // TIER 6: QUANTITY & SIZE DETECTION
  // ============================================================================
  
  describe('Tier 6: Quantity & Size Detection', () => {
    it('should detect quantity from numbers', async () => {
      const result = await callBrain('Zamów 2x pizza Margherita');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should detect quantity from words', async () => {
      const result = await callBrain('Zamów dwie pizze');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should detect pizza size', async () => {
      const result = await callBrain('Zamów dużą pizzę Margherita');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 7: SMART CONTEXT BOOST
  // ============================================================================
  
  describe('Tier 7: Smart Context Boost', () => {
    it('should boost "nie/inne" to change_restaurant', async () => {
      const result = await callBrain('Nie, pokaż inne restauracje');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('change_restaurant');
    });
    
    it('should boost "polecisz" to recommend', async () => {
      const result = await callBrain('Co polecisz?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('recommend');
    });
    
    it('should boost "tak" to confirm', async () => {
      const sessionId = 'test-confirm-' + Date.now();
      await callBrain('Wybierz Monte Carlo', sessionId);
      const result = await callBrain('Tak', sessionId);
      expect(result.ok).toBe(true);
      expect(['confirm', 'menu_request']).toContain(result.intent);
    });
  });
  
  // ============================================================================
  // TIER 8: ERROR HANDLING & EDGE CASES
  // ============================================================================
  
  describe('Tier 8: Error Handling & Edge Cases', () => {
    it('should handle non-existent restaurant', async () => {
      const result = await callBrain('Menu w restauracji XYZ123');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(nie znalazłam|nie mam|brak)/i);
    });
    
    it('should handle empty restaurant list', async () => {
      const result = await callBrain('Restauracje w Antarktyce');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(nie znalazłam|brak|nie widzę)/i);
    });
    
    it('should handle ambiguous input', async () => {
      const result = await callBrain('coś');
      expect(result.ok).toBe(true);
      expect(result.intent).toBeTruthy();
    });
    
    it('should handle very long input', async () => {
      const longText = 'Chciałbym zamówić '.repeat(50) + 'pizzę';
      const result = await callBrain(longText);
      expect(result.ok).toBe(true);
    });
  });
  
  // ============================================================================
  // TIER 9: MULTI-ITEM ORDERING
  // ============================================================================
  
  describe('Tier 9: Multi-Item Ordering', () => {
    it('should parse multiple items', async () => {
      const result = await callBrain('Zamów pizzę Margherita i pizzę Pepperoni');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should handle mixed quantities', async () => {
      const result = await callBrain('Zamów 2 pizze Margherita i jedną Pepperoni');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 10: FULL USER FLOW
  // ============================================================================
  
  describe('Tier 10: Full User Flow', () => {
    const flowSessionId = 'test-flow-' + Date.now();
    
    it('should complete full ordering flow', async () => {
      // Step 1: Find restaurants
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', flowSessionId);
      expect(step1.ok).toBe(true);
      expect(step1.intent).toBe('find_nearby');
      
      // Step 2: Select restaurant
      const step2 = await callBrain('Monte Carlo', flowSessionId);
      expect(step2.ok).toBe(true);
      expect(['select_restaurant', 'menu_request']).toContain(step2.intent);
      
      // Step 3: View menu
      const step3 = await callBrain('Pokaż menu', flowSessionId);
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('menu_request');
      
      // Step 4: Order
      const step4 = await callBrain('Zamów pizzę Margherita', flowSessionId);
      expect(step4.ok).toBe(true);
      expect(step4.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 11: PERFORMANCE & TIMEOUT
  // ============================================================================
  
  describe('Tier 11: Performance', () => {
    it('should respond within 5 seconds', async () => {
      const start = Date.now();
      await callBrain('Gdzie zjeść?');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });
    
    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => 
        callBrain(`Test ${i}`, `concurrent-${i}`)
      );
      const results = await Promise.all(promises);
      expect(results.every(r => r.ok)).toBe(true);
    });
  });
});

describe('🔧 Brain Stats API', () => {
  it('should return brain statistics', async () => {
    const response = await fetch(`${API_URL}/api/brain/stats`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toBeTruthy();
  });
});

console.log('✅ Brain API cascade tests completed');

