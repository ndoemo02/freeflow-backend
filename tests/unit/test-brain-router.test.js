/**
 * Testy jednostkowe dla brainRouter
 * Testuje logikę boostIntent i parsowania restauracji
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { boostIntent } from '../../api/brain/brainRouter.js';

const parseRestaurantAndDish = (text) => {
  const normalized = text.toLowerCase();

  // Pattern 0: "Pokaż menu" (bez nazwy restauracji — użyj kontekstu sesji)
  if (/^(pokaż\s+)?menu$/i.test(text.trim())) {
    return { dish: null, restaurant: null };
  }

  // Pattern 1: "Zamów [danie] [nazwa restauracji]"
  const orderPattern = /(?:zamów|poproszę|chcę)\s+([a-ząćęłńóśźż\s]+?)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const orderMatch = text.match(orderPattern);
  if (orderMatch) {
    let dish = orderMatch[1]?.trim();
    dish = dish?.replace(/ę$/i, 'a').replace(/a$/i, 'a');
    return { dish, restaurant: orderMatch[2]?.trim() };
  }

  // Pattern 2: "Pokaż menu [nazwa restauracji]"
  const menuPattern = /(?:pokaż\s+)?menu\s+(?:w\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const menuMatch = text.match(menuPattern);
  if (menuMatch) {
    return { dish: null, restaurant: menuMatch[1]?.trim() };
  }

  // Pattern 3: "Zjedz w [nazwa miejsca]" (ale NIE "menu" ani słowa kluczowe nearby)
  const locationPattern = /(?:w|z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const locationMatch = text.match(locationPattern);
  if (locationMatch) {
    const extracted = locationMatch[1]?.trim();
    // Ignoruj jeśli to słowo kluczowe (menu, zamówienie, nearby keywords)
    if (extracted && !/(menu|zamówienie|zamówienia|pobliżu|okolicy|blisko|okolice|pobliżach)/i.test(extracted)) {
      return { dish: null, restaurant: extracted };
    }
  }

  return { dish: null, restaurant: null };
};

describe('boostIntent Function', () => {
  it('should not modify high confidence intents', () => {
    expect(boostIntent('test', 'find_nearby', 0.9)).toBe('find_nearby');
    expect(boostIntent('test', 'menu_request', 0.85)).toBe('menu_request');
  });

  it('should detect confirm intent', () => {
    expect(boostIntent('tak', 'none', 0.5)).toBe('confirm');
    expect(boostIntent('ok', 'none', 0.5)).toBe('confirm');
    expect(boostIntent('dobrze', 'none', 0.5)).toBe('confirm');
  });

  it('should detect change_restaurant intent', () => {
    expect(boostIntent('nie', 'none', 0.5)).toBe('change_restaurant');
    expect(boostIntent('pokaż inne', 'none', 0.5)).toBe('change_restaurant');
    expect(boostIntent('zmień restaurację', 'none', 0.5)).toBe('change_restaurant');
  });

  it('should detect recommend intent', () => {
    expect(boostIntent('co polecasz', 'none', 0.5)).toBe('recommend');
    expect(boostIntent('co warto zjeść', 'none', 0.5)).toBe('recommend');
    expect(boostIntent('polecisz coś', 'none', 0.5)).toBe('recommend');
  });

  it('should detect find_nearby for quick food', () => {
    expect(boostIntent('na szybko', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('coś szybkiego', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('fast food', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for general food search', () => {
    expect(boostIntent('mam ochotę na coś', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('chcę coś zjeść', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('szukam czegoś do jedzenia', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for availability queries', () => {
    expect(boostIntent('co jest dostępne', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co w pobliżu', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co jest w okolicy', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co mam w pobliżu', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for vegetarian queries', () => {
    expect(boostIntent('coś wegetariańskiego', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('wegańskie jedzenie', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('roślinne opcje', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect create_order intent', () => {
    expect(boostIntent('zamów tutaj', 'none', 0.5)).toBe('create_order');
    expect(boostIntent('chcę to zamówić', 'none', 0.5)).toBe('create_order');
    expect(boostIntent('zamów to', 'none', 0.5)).toBe('create_order');
  });

  it('should detect menu_request intent', () => {
    expect(boostIntent('pokaż menu', 'none', 0.5)).toBe('menu_request');
    expect(boostIntent('co mają w menu', 'none', 0.5)).toBe('menu_request');
    expect(boostIntent('zobacz co serwują', 'none', 0.5)).toBe('menu_request');
  });

  it('should fallback to find_nearby for generic food keywords', () => {
    expect(boostIntent('restauracja', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('chcę zjeść', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('posiłek', 'none', 0.5)).toBe('find_nearby');
  });

  it('should return original intent if no patterns match', () => {
    expect(boostIntent('random text', 'menu_request', 0.5)).toBe('menu_request');
    expect(boostIntent('hello world', 'none', 0.5)).toBe('none');
  });
});

describe('parseRestaurantAndDish Function', () => {
  it('should parse simple menu requests', () => {
    expect(parseRestaurantAndDish('menu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('pokaż menu')).toEqual({ dish: null, restaurant: null });
  });

  it('should parse order with restaurant', () => {
    const result = parseRestaurantAndDish('zamów pizzę Monte Carlo');
    expect(result.dish).toBe('pizza');
    expect(result.restaurant).toBe('Monte Carlo');
  });

  it('should parse menu requests with restaurant', () => {
    const result = parseRestaurantAndDish('pokaż menu Tasty King');
    expect(result.dish).toBe(null);
    expect(result.restaurant).toBe('Tasty King');
  });

  it('should parse location-based requests', () => {
    const result = parseRestaurantAndDish('zjedz w Piekarach');
    expect(result.dish).toBe(null);
    // parseRestaurantAndDish zwraca "w Piekarach" (z prefiksem "w")
    expect(result.restaurant).toBe('w Piekarach');
  });

  it('should ignore nearby keywords in location parsing', () => {
    expect(parseRestaurantAndDish('co jest dostępne w pobliżu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('coś w okolicy')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('blisko mnie')).toEqual({ dish: null, restaurant: null });
  });

  it('should ignore menu keywords in location parsing', () => {
    expect(parseRestaurantAndDish('pokaż menu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('zamówienie')).toEqual({ dish: null, restaurant: null });
  });

  it('should handle complex restaurant names', () => {
    const result = parseRestaurantAndDish('zamów burger Burger King');
    expect(result.dish).toBe('burger');
    expect(result.restaurant).toBe('Burger King');
  });

  it('should return null for unrecognized patterns', () => {
    expect(parseRestaurantAndDish('hello world')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('random text')).toEqual({ dish: null, restaurant: null });
  });
});

describe('Edge Cases', () => {
  it('should handle empty strings', () => {
    expect(boostIntent('', 'none', 0.5)).toBe('none');
    expect(parseRestaurantAndDish('')).toEqual({ dish: null, restaurant: null });
  });

  it('should handle special characters', () => {
    expect(boostIntent('co jest dostępne?', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('zamów tutaj!', 'none', 0.5)).toBe('create_order');
  });

  it('should handle mixed case', () => {
    expect(boostIntent('CO JEST DOSTĘPNE', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('Pokaż Menu', 'none', 0.5)).toBe('menu_request');
  });
});

describe('expectedContext Follow-up Logic', () => {
  it('should detect show_more_options when expectedContext is set', () => {
    const session = { expectedContext: 'show_more_options' };
    expect(boostIntent('pokaż więcej', 'none', 0.5, session)).toBe('show_more_options');
    expect(boostIntent('pokaż więcej opcji', 'none', 0.5, session)).toBe('show_more_options');
    expect(boostIntent('pokaż wszystkie', 'none', 0.5, session)).toBe('show_more_options');
    expect(boostIntent('pokaż pozostałe', 'none', 0.5, session)).toBe('show_more_options');
    expect(boostIntent('więcej opcji', 'none', 0.5, session)).toBe('show_more_options');
  });

  it('should detect select_restaurant when expectedContext is set', () => {
    const session = { expectedContext: 'select_restaurant' };
    expect(boostIntent('wybieram', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('wybierz', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('ta pierwsza', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('ta druga', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('numer 1', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('numer 2', 'none', 0.5, session)).toBe('select_restaurant');
    expect(boostIntent('2', 'none', 0.5, session)).toBe('select_restaurant');
  });

  it('should ignore expectedContext when user says something unrelated', () => {
    const session = { expectedContext: 'show_more_options' };
    // Użytkownik ignoruje pytanie i mówi coś zupełnie innego
    expect(boostIntent('zamów taksówkę', 'none', 0.5, session)).not.toBe('show_more_options');
    expect(boostIntent('pokaż menu', 'none', 0.5, session)).toBe('menu_request');
  });

  it('should not trigger expectedContext when session is null', () => {
    expect(boostIntent('pokaż więcej', 'none', 0.5, null)).not.toBe('show_more_options');
    expect(boostIntent('wybieram', 'none', 0.5, null)).not.toBe('select_restaurant');
  });

  it('should not trigger expectedContext when expectedContext is null', () => {
    const session = { expectedContext: null };
    expect(boostIntent('pokaż więcej', 'none', 0.5, session)).not.toBe('show_more_options');
    expect(boostIntent('wybieram', 'none', 0.5, session)).not.toBe('select_restaurant');
  });

  it('should prioritize expectedContext over other patterns', () => {
    const session = { expectedContext: 'show_more_options' };
    // "pokaż więcej" normalnie mogłoby być interpretowane jako inne intencje,
    // ale expectedContext ma najwyższy priorytet
    expect(boostIntent('pokaż więcej', 'find_nearby', 0.5, session)).toBe('show_more_options');
  });

  it('should not override high confidence intents even with expectedContext', () => {
    const session = { expectedContext: 'show_more_options' };
    // Jeśli intencja ma wysoką pewność (≥0.8), nie powinna być nadpisana
    expect(boostIntent('pokaż więcej', 'menu_request', 0.9, session)).toBe('menu_request');
  });

  it('should detect confirm_order when expectedContext is confirm_order', () => {
    const session = { expectedContext: 'confirm_order' };
    // Proste potwierdzenia
    expect(boostIntent('tak', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('ok', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('dobrze', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('zgoda', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('pewnie', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('jasne', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('oczywiście', 'none', 0.5, session)).toBe('confirm_order');

    // Potwierdzenia z "dodaj"
    expect(boostIntent('dodaj', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('dodaj do koszyka', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('proszę dodać', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('dodaj proszę', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('tak dodaj', 'none', 0.5, session)).toBe('confirm_order');

    // Potwierdzenia z "zamów"
    expect(boostIntent('zamów', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('zamawiam', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('tak zamawiam', 'none', 0.5, session)).toBe('confirm_order');

    // Potwierdzenia z "potwierdź"
    expect(boostIntent('potwierdź', 'none', 0.5, session)).toBe('confirm_order');
    expect(boostIntent('potwierdzam', 'none', 0.5, session)).toBe('confirm_order');
  });

  it('should detect cancel_order when expectedContext is confirm_order and user says "nie"', () => {
    const session = { expectedContext: 'confirm_order' };
    expect(boostIntent('nie', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('anuluj', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('nie chcę', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('nie chce', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('rezygnuję', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('rezygnuje', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('nie teraz', 'none', 0.5, session)).toBe('cancel_order');
    expect(boostIntent('nie zamawiaj', 'none', 0.5, session)).toBe('cancel_order');
  });

  it('should not trigger confirm_order when expectedContext is different', () => {
    const session = { expectedContext: 'show_more_options' };
    // "tak" powinno być interpretowane jako "confirm", nie "confirm_order"
    expect(boostIntent('tak', 'none', 0.5, session)).toBe('confirm');
  });

  it('should not trigger confirm_order when session is null', () => {
    expect(boostIntent('tak', 'none', 0.5, null)).toBe('confirm');
    expect(boostIntent('nie', 'none', 0.5, null)).toBe('change_restaurant');
  });
});
