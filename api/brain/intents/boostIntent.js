import { normalizeTxt } from "./intentRouterGlue.js";
import { extractLocation } from "../helpers.js";

export function boostIntent(text, intent, confidence = 0, session = null) {
  if (!text) return intent;
  const lower = normalizeTxt(text); // używamy normalizeTxt z intent-router (stripuje diacritics)
  const ctx = session || {};
  const expected = session?.expectedContext;

  // === SMART CONFIRMATION HANDLER ===
  // Jeśli bot oczekuje "show_menu", to każda odpowiedź typu
  // "tak", "pokaż", "chętnie", "zobaczę", "z przyjemnością"
  // powinna zostać zmapowana na intent: "show_menu".
  if (expected === "show_menu") {
    if (
      lower.includes("tak") ||
      lower.includes("pewnie") ||
      lower.includes("jasne") ||
      lower.includes("poproszę") ||
      lower.includes("chętnie") ||
      lower.includes("z przyjemnością") ||
      lower.includes("pokaż") ||
      lower.includes("zobaczę") ||
      lower.includes("zobacz")
    ) {
      return {
        intent: "show_menu",
        confidence: 0.99,
        fromExpected: true,
      };
    }
  }

  // --- Fast intent detection (no model delay) ---
  const fastNegCancel = /\b(anuluj|odwołaj|odwolaj|rezygnuj)\b/i;
  const fastNegChange = /\b(nie|inna|inne|zmien|zmień)\b/i;
  const fastShowMore = /\b(pokaz\s*(wiecej|reszte|opcje)|wiecej)\b/i;

  // Wykluczenie: jeśli "anuluj zamówienie" - priorytet najwyższy
  if (/\banuluj\s+zamowienie\b/i.test(lower)) return 'cancel_order';

  // Wykluczenie: jeśli "anuluj zamówienie" zawiera "zamówienie", ale jest w kontekście pendingOrder/confirm → cancel
  if (fastNegCancel.test(lower) && (ctx?.pendingOrder || ctx?.expectedContext === 'confirm_order')) {
    return 'cancel_order';
  }
  if (fastNegChange.test(lower) && !(ctx?.expectedContext === 'confirm_order') && !/\b(anuluj|rezygnuj)\b/i.test(lower)) return 'change_restaurant';
  if (fastShowMore.test(lower)) return 'show_more_options';

  // Preferencja: pytania w stylu "gdzie zjeść ..." zawsze traktuj jako find_nearby
  // nawet jeśli w tekście jest słowo "pizza" (żeby nie przełączać na create_order)
  if ((/\bgdzie\b/i.test(lower) && (/(zjesc|zjem)/i.test(lower) || /(pizza|pizz)/i.test(lower)))) {
    return 'find_nearby';
  }

  // "Nie, pokaż inne restauracje" → change_restaurant (globalnie, poza confirm context)
  if ((/\bnie\b/.test(lower) && /(pokaz|pokaz|pokaz|pokaż|inne)/i.test(lower) && /(restaurac|opcje)/i.test(lower)) && ctx?.expectedContext !== 'confirm_order') {
    return 'change_restaurant';
  }

  // Wieloelementowe zamowienia: "zamow ... i ..." → create_order
  if (/(zamow|zamowic|zamowisz|zamowmy|poprosze|prosze)/i.test(lower) && /\bi\b/.test(lower) && /(pizza|pizz|burger|kebab)/i.test(lower)) {
    return 'create_order';
  }

  // 🔥 NEW RULE: If user message matches any known restaurant → force select_restaurant
  // This runs before SmartContext to ensure restaurant names are always prioritized
  const knownRestaurants = [
    'rezydencja', 'villa', 'angelo', 'royal', 'pizzeria',
    'hotel', 'palace', 'park', 'restaurant'
  ];

  const restaurantMatch = knownRestaurants.find(name =>
    lower.includes(name.toLowerCase())
  );

  if (restaurantMatch && session?.last_restaurants_list?.length > 0) {
    console.log(`🔥 Restaurant name detected: "${restaurantMatch}" → forcing select_restaurant`);
    return 'select_restaurant';
  }

  // --- PRIORITY 0: Negations in confirm flow (cancel/change) ---
  // Obsługa "anuluj" → cancel_order (jeśli pendingOrder lub expectedContext=confirm_order)
  if ((ctx?.expectedContext === 'confirm_order' || ctx?.pendingOrder) && /\b(anuluj|rezygnuj|odwołaj|odwolaj)\b/i.test(lower)) {
    console.log('🧠 SmartContext (PRIORITY 0) → intent=cancel_order (anuluj w confirm_order context)');
    return 'cancel_order';
  }

  // Obsługa "nie/inne/zmień" → change_restaurant (jeśli pendingOrder lub expectedContext=confirm_order lub lastIntent=create_order)
  if ((ctx?.expectedContext === 'confirm_order' || ctx?.pendingOrder || ctx?.lastIntent === 'create_order') &&
    /\b(nie|inne|zmien|zmień|inna|inny)\b/i.test(lower) && !/\b(anuluj|rezygnuj|odwołaj)\b/i.test(lower)) {
    console.log('🧠 SmartContext (PRIORITY 0) → intent=change_restaurant (nie/inne w confirm_order context)');
    return 'change_restaurant';
  }

  // --- Global short-circuits for concise follow-ups ---
  // 1) "pokaż więcej" (ale NIE "inne" - to może oznaczać change_restaurant)
  const moreAnyRx = /\b(pokaz\s*(wiecej|reszte|opcje)|wiecej)\b/i;
  if (moreAnyRx.test(lower) && !/\b(nie|inna|inny)\b/i.test(lower)) {
    console.log('🧠 SmartContext (global) → intent=show_more_options (phrase: "pokaż więcej")');
    return 'show_more_options';
  }

  // 2) "wybieram numer 1" / liczebnik porządkowy / sama cyfra → select_restaurant
  const numberOnlyMatch = text.trim().match(/^\s*([1-9])\s*$/);
  const ordinalPlAny = /(pierwsza|pierwszy|druga|drugi|trzecia|trzeci|czwarta|czwarty|piata|piaty|szosta|szosty|siodma|siodmy|osma|osmy|dziewiata|dziewiaty)/i;
  if (numberOnlyMatch || ordinalPlAny.test(lower) || /\b(wybieram|wybierz)\b/i.test(lower) || /\bnumer\s+[1-9]\b/i.test(lower)) {
    console.log('🧠 SmartContext (global) → intent=select_restaurant (phrase: number/ordinal)');
    return 'select_restaurant';
  }

  // 🧠 FOLLOW-UP CONTEXT LOGIC - DRUGI PRIORYTET
  // Sprawdź oczekiwany kontekst PRZED innymi regułami semantycznymi
  if (ctx?.expectedContext) {
    console.log(`🧠 SmartContext: checking expected context: ${ctx.expectedContext}`);

    // Oczekiwany kontekst: "pokaż więcej opcji"
    if (ctx.expectedContext === 'show_more_options') {
      // -- SHOW MORE OPTIONS (kontekstowo) --
      const moreRx = /\b(pokaz\s*(wiecej|reszte)|wiecej|inne|pokaz\s*opcje)\b/i;
      if (moreRx.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=show_more_options (expected context)');
        return 'show_more_options';
      }
      // nic nie mówimy → nie nadpisuj na cokolwiek innego (fall-through bez zmiany)
    }

    // Oczekiwany kontekst: "wybierz restaurację"
    if (ctx.expectedContext === 'select_restaurant') {
      // -- SELECT RESTAURANT (cyfra lub liczebnik porządkowy) --
      const numberOnly = text.trim().match(/^\s*([1-9])\s*$/); // "1".."9" solo
      const ordinalPl = /(pierwsz(ą|y)|drug(ą|i)|trzeci(ą|i)|czwart(ą|y)|piąt(ą|y)|szóst(ą|y)|siódm(ą|y)|ósm(ą|y)|dziewiąt(ą|y))/i;
      if (numberOnly || ordinalPl.test(lower) || /(wybieram|wybierz|numer\s+[1-9])/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=select_restaurant (expected context)');
        return 'select_restaurant';
      }
    }

    // Oczekiwany kontekst: "potwierdź zamówienie" (NAJWYŻSZY PRIORYTET!)
    if (ctx.expectedContext === 'confirm_order') {
      console.log('🧠 SmartContext: expectedContext=confirm_order detected, checking user response...');

      // "Nie, pokaż inne ..." → zmiana restauracji nawet w confirm flow
      if (/\bnie\b/.test(lower) && /(pokaz|pokaż|inne)/i.test(lower) && /(restaurac|opcje)/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=change_restaurant (nie + inne/pokaż w confirm context)');
        return 'change_restaurant';
      }

      // Jeśli użytkownik wypowiada pełną komendę zamówienia (z daniem/ilością), traktuj jako NOWE create_order
      const hasDishOrQty = /(pizza|pizz|burger|kebab|tiramisu|salat|słat|zupa|makaron)/i.test(lower) || /\b(\d+|dwie|trzy|cztery|piec|pięc|szesc|siedem|osiem|dziewiec|dziesiec)\b/i.test(lower);
      if (hasDishOrQty && /(zamow|zamowic|poprosze|wezm|biore|zamawiam)/i.test(lower)) {
        console.log('🧠 SmartContext: confirm->create_order (detected explicit order with items/quantity)');
        return 'create_order';
      }

      // Potwierdzenie - bardziej elastyczne dopasowanie
      // Dopuszcza: "tak", "ok", "dodaj", "proszę dodać", "tak dodaj", "dodaj proszę", etc.
      // Używamy `lower` (znormalizowany tekst bez polskich znaków) dla większości sprawdzeń
      if (/(^|\s)(tak|ok|dobrze|zgoda|pewnie|jasne|oczywiscie)(\s|$)/i.test(lower) ||
        /dodaj|dodac|zamow|zamawiam|potwierdz|potwierdzam/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=confirm_order (expected context, user confirmed)');
        return 'confirm_order';
      }

      // Negacja w confirm → traktuj jako anulowanie zamówienia
      const neg = /\b(nie|anuluj|rezygnuj)\b/i;
      if (neg.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=cancel_order (negation within confirm context)');
        return 'cancel_order';
      }

      // Jeśli user mówi wyraźnie "anuluj" → cancel
      if (/\b(anuluj|rezygnuj|odwołaj)\b/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=cancel_order (explicit cancel)');
        return 'cancel_order';
      }

      console.log('⚠️ SmartContext: expectedContext=confirm_order but user response unclear, falling through...');
    }
  }

  // Nie modyfikuj jeśli intencja jest bardzo pewna (NAJWYŻSZY PRIORYTET)
  // WYJĄTEK: jeśli był expectedContext powyżej, to już zwróciliśmy wcześniej
  if (confidence >= 0.8) {
    console.log(`🧠 SmartContext: skipping boost (confidence=${confidence})`);
    return intent;
  }

  // 🧠 FALLBACK: Jeśli nie ma expectedContext, ale lastIntent to create_order,
  // a użytkownik mówi "nie", to prawdopodobnie chce anulować zamówienie
  if (!session?.expectedContext && session?.lastIntent === 'create_order' &&
    /(^|\s)(nie|anuluj|rezygnuje|rezygnuję)(\s|$)/i.test(lower)) {
    console.log('🧠 SmartContext Fallback → intent=cancel_order (lastIntent=create_order + "nie")');
    return 'cancel_order';
  }

  // 🧠 Dodatkowy fallback: jeśli poprzedni krok to clarify_order (prośba o doprecyzowanie),
  // a użytkownik mówi "nie/anuluj", potraktuj to jako anulowanie
  if (!session?.expectedContext && session?.lastIntent === 'clarify_order' &&
    /(^|\s)(nie|anuluj|rezygnuje|rezygnuję)(\s|$)/i.test(lower)) {
    console.log('🧠 SmartContext Fallback → intent=cancel_order (lastIntent=clarify_order + "nie")');
    return 'cancel_order';
  }

  // Follow-up logic — krótkie odpowiedzi kontekstowe
  if (/^(tak|ok|dobrze|zgoda|pewnie)$/i.test(text.trim())) {
    console.log('🧠 SmartContext Boost → intent=confirm (phrase: "tak")');
    return 'confirm';
  }

  // "Wege" / "wegetariańskie" → find_nearby (PRZED change_restaurant, bo "roślinne" zawiera "inne")
  if (/(wege|wegetarian|wegetariańsk|roslinne|roślinne)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "wege")');
    return 'find_nearby';
  }

  // Zmiana restauracji — dopuszcza "nie, pokaż inne", "nie chcę tego", etc.
  // Word boundaries \b aby nie wykrywać "nie" w "wege"
  // Dodatkowa ochrona: nie wykrywaj jeśli tekst zawiera "wege" lub "wegetarian"
  // Preferuj anulowanie, jeśli istnieje oczekujące zamówienie
  try {
    if (session?.pendingOrder && /(\bnie\b|anuluj|rezygnuje|rezygnuję)/i.test(lower)) {
      console.log('🧠 SmartContext Boost → intent=cancel_order (pendingOrder present)');
      return 'cancel_order';
    }
  } catch { }

  if (/(\bnie\b|zmien|zmień|\binne\b|cos innego|coś innego|pokaz inne|pokaż inne|inna restaurac)/i.test(lower) &&
    !/wege|wegetarian|roslinne/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=change_restaurant (phrase: "nie/inne")');
    return 'change_restaurant';
  }

  // Rekomendacje
  if (/(polec|polecasz|co polecasz|co warto|co dobre|co najlepsze|co najlepsze)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=recommend (phrase: "polecisz")');
    return 'recommend';
  }

  // "Na szybko" / "coś szybkiego" → find_nearby z fast food
  if (/(na szybko|cos szybkiego|coś szybkiego|szybkie jedzenie|fast food)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "na szybko")');
    return 'find_nearby';
  }

  // "Mam ochotę na" / "chcę coś" → find_nearby
  if (/(mam ochote|mam ochotę|ochote na|ochotę na|chce cos|chcę coś|szukam czegos|szukam czegoś)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "mam ochotę")');
    return 'find_nearby';
  }

  // "Co jest dostępne" / "co w pobliżu" → find_nearby
  if (/(co jest dostepne|co jest dostępne|co dostepne|co dostępne|co w poblizu|co w pobliżu|co w okolicy|co jest w okolicy|co mam w poblizu|co mam w pobliżu)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "co dostępne")');
    return 'find_nearby';
  }

  // "Zamów tutaj" / "zamów to" → create_order
  if (/(zamów tutaj|zamow tutaj|zamów tu|zamow tu|chcę to zamówić|chce to zamowic|zamów to|zamow to)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=create_order (phrase: "zamów tutaj")');
    return 'create_order';
  }

  // Menu keywords — wykryj przed fallback do none
  if (/(menu|karta|co mają|co maja|co serwują|co serwuja|zobacz co|zobacz menu)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=menu_request (phrase: "menu/zobacz co")');
    return 'menu_request';
  }

  // Jeśli intent=none, spróbuj wykryć semantycznie
  if (intent === 'none') {
    // Nearby keywords - dodano więcej wariantów z Polish characters
    if (/(restaurac|restaurację|zjesc|zjeść|jedzenie|posilek|posiłek|obiad|kolacja|śniadanie|sniadanie)/i.test(lower)) {
      console.log('🧠 SmartContext Boost → intent=find_nearby (fallback from none)');
      return 'find_nearby';
    }

    // 🔥 NOWE: Jeśli user podał samo miasto (np. "Piekary Śląskie") → find_nearby
    // Sprawdź czy extractLocation wykrywa miasto w tekście
    const detectedCity = extractLocation(text);
    if (detectedCity) {
      console.log(`🧠 SmartContext Boost → intent=find_nearby (detected city: "${detectedCity}")`);
      return 'find_nearby';
    }
  }

  // 🔧 Force create_order when user has a selected restaurant and talks about pizza/order
  if (intent === 'find_nearby' && session?.lastRestaurant) {
    const hasOrderKeyword = /(zamow|zamów|poprosze|poproszę|wezme|wezmę|biore|biorę)/i.test(lower);
    const hasPizzaKeyword = /\bpizz/i.test(lower);
    if (hasOrderKeyword || hasPizzaKeyword) {
      console.log('🧠 SmartContext Boost → intent=create_order (session.lastRestaurant present + order/pizza keyword)');
      return 'create_order';
    }
  }

  return intent; // Zwróć oryginalną intencję
}
