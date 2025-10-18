// /api/brain/brainRouter.js - Optimized version
import { detectIntent, normalizeTxt } from "./intent-router.js";
import { supabase } from "../_supabase.js";
import { getSession, updateSession } from "./context.js";
import {
  normalize, fuzzyMatch, extractLocation, extractCuisineType,
  extractQuantity, extractSize, levenshtein
} from "./helpers.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// ============================================================================
// CUISINE & LOCATION HELPERS
// ============================================================================

const CUISINE_ALIASES = {
  'azjatyckie': ['Wietnamska', 'Chińska', 'Tajska'],
  'azjatyckiej': ['Wietnamska', 'Chińska', 'Tajska'],
  'orientalne': ['Wietnamska', 'Chińska'],
  'fastfood': ['Amerykańska', 'Kebab'],
  'fast food': ['Amerykańska', 'Kebab'],
  'na szybko': ['Amerykańska', 'Kebab'],
  'burger': ['Amerykańska'],
  'pizza': ['Włoska'],
  'wloska': ['Włoska'],
  'kebab': ['Kebab'],
  'lokalne': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'wege': []
};

const NEARBY_CITY_SUGGESTIONS = {
  'bytom': ['Piekary Śląskie', 'Katowice', 'Zabrze'],
  'katowice': ['Piekary Śląskie', 'Bytom', 'Chorzów'],
  'zabrze': ['Piekary Śląskie', 'Bytom', 'Gliwice'],
  'gliwice': ['Zabrze', 'Piekary Śląskie'],
  'chorzow': ['Katowice', 'Piekary Śląskie', 'Bytom']
};

function expandCuisineType(cuisineType) {
  if (!cuisineType) return null;
  const normalized = normalize(cuisineType);
  return CUISINE_ALIASES[normalized] || [cuisineType];
}

function groupRestaurantsByCategory(restaurants) {
  return restaurants.reduce((acc, r) => {
    const cuisine = r.cuisine_type || 'Inne';
    if (!acc[cuisine]) acc[cuisine] = [];
    acc[cuisine].push(r);
    return acc;
  }, {});
}

function getCuisineFriendlyName(cuisineType) {
  const mapping = {
    'Amerykańska': 'fast-foody i burgery',
    'Kebab': 'kebaby',
    'Włoska': 'pizzerie',
    'Polska': 'kuchnię polską',
    'Śląska / Europejska': 'kuchnię europejską',
    'Wietnamska': 'kuchnię azjatycką',
    'Chińska': 'kuchnię azjatycką',
    'Tajska': 'kuchnię azjatycką'
  };
  return mapping[cuisineType] || cuisineType.toLowerCase();
}

// ============================================================================
// RESTAURANT & MENU HELPERS
// ============================================================================

function parseRestaurantAndDish(text) {
  const normalized = text.toLowerCase();
  
  if (/^(pokaż\s+)?menu$/i.test(text.trim())) {
    return { dish: null, restaurant: null };
  }
  
  const orderPattern = /(?:zamów|poproszę|chcę)\s+([a-ząćęłńóśźż\s]+?)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const orderMatch = text.match(orderPattern);
  if (orderMatch) {
    let dish = orderMatch[1]?.trim().replace(/ę$/i, 'a');
    return { dish, restaurant: orderMatch[2]?.trim() };
  }
  
  const menuPattern = /(?:pokaż\s+)?menu\s+(?:w\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const menuMatch = text.match(menuPattern);
  if (menuMatch) {
    return { dish: null, restaurant: menuMatch[1]?.trim() };
  }
  
  const locationPattern = /(?:w|z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const locationMatch = text.match(locationPattern);
  if (locationMatch) {
    const extracted = locationMatch[1]?.trim();
    if (extracted && !/(menu|zamówienie|pobliżu|okolicy)/i.test(extracted)) {
      return { dish: null, restaurant: extracted };
    }
  }
  
  return { dish: null, restaurant: null };
}

async function findRestaurant(name) {
  if (!name) return null;
  try {
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, address, city, lat, lng');
    
    if (error || !restaurants?.length) return null;
    
    const matched = restaurants.find(r => fuzzyMatch(name, r.name, 3));
    if (matched) return matched;
    
    const alias = restaurants.find(r => 
      normalize(r.name).startsWith(normalize(name).split(' ')[0])
    );
    return alias || null;
  } catch (err) {
    console.error('⚠️ findRestaurant error:', err.message);
    return null;
  }
}

async function findDishInMenu(restaurantId, dishName) {
  if (!restaurantId || !dishName) return null;
  try {
    const { data: menu, error } = await supabase
      .from('menu_items')
      .select('id, name, price, description')
      .eq('restaurant_id', restaurantId);
    
    if (error || !menu?.length) return null;
    
    const normalizedDish = normalize(dishName);
    let matched = menu.find(item => normalize(item.name) === normalizedDish);
    if (matched) return matched;
    
    matched = menu.find(item => {
      const normName = normalize(item.name);
      return normName.includes(normalizedDish) || normalizedDish.includes(normName);
    });
    if (matched) return matched;
    
    matched = menu.find(item => fuzzyMatch(dishName, item.name, 3));
    return matched || null;
  } catch (err) {
    console.error('❌ findDishInMenu error:', err);
    return null;
  }
}

async function parseOrderItems(text, restaurantId) {
  if (!text || !restaurantId) return [];
  try {
    const { data: menu, error } = await supabase
      .from('menu_items')
      .select('id, name, price')
      .eq('restaurant_id', restaurantId);
    
    if (error || !menu?.length) return [];
    
    const items = [];
    const normalized = normalize(text);
    const quantity = extractQuantity(text);
    
    for (const menuItem of menu) {
      const dishName = normalize(menuItem.name);
      if (fuzzyMatch(text, menuItem.name, 3) || normalized.includes(dishName)) {
        items.push({
          id: menuItem.id,
          name: menuItem.name,
          price: parseFloat(menuItem.price),
          quantity
        });
      }
    }
    
    if (items.length === 0) {
      const parsed = parseRestaurantAndDish(text);
      if (parsed.dish) {
        const matched = await findDishInMenu(restaurantId, parsed.dish);
        if (matched) {
          items.push({
            id: matched.id,
            name: matched.name,
            price: parseFloat(matched.price),
            quantity
          });
        }
      }
    }
    
    return items;
  } catch (err) {
    console.error('❌ parseOrderItems error:', err);
    return [];
  }
}

async function findRestaurantsByLocation(location, cuisineType = null) {
  if (!location) return null;
  try {
    let query = supabase
      .from('restaurants')
      .select('id, name, address, city, cuisine_type, lat, lng')
      .ilike('city', `%${location}%`);
    
    if (cuisineType) {
      const cuisineList = expandCuisineType(cuisineType);
      if (cuisineList && cuisineList.length > 1) {
        query = query.in('cuisine_type', cuisineList);
      } else if (cuisineList && cuisineList.length === 1) {
        query = query.eq('cuisine_type', cuisineList[0]);
      }
    }
    
    const { data, error } = await query.limit(10);
    return error ? null : data;
  } catch (err) {
    console.error('⚠️ findRestaurantsByLocation error:', err.message);
    return null;
  }
}

async function getLocationFallback(prevLocation, messageTemplate) {
  if (!prevLocation) return null;
  const locationRestaurants = await findRestaurantsByLocation(prevLocation);
  if (!locationRestaurants?.length) return null;
  
  const restaurantList = locationRestaurants.map((r, i) => `${i+1}. ${r.name}`).join('\n');
  return messageTemplate
    .replace('{location}', prevLocation)
    .replace('{count}', locationRestaurants.length)
    .replace('{list}', restaurantList);
}

// ============================================================================
// SMART CONTEXT BOOST
// ============================================================================

export function boostIntent(text, intent, confidence = 0) {
  if (!text || confidence >= 0.8) return intent;
  const lower = normalizeTxt(text);
  
  if (/^(tak|ok|dobrze|zgoda|pewnie)$/i.test(text.trim())) return 'confirm';
  if (/(wege|wegetarian|roslinne|roślinne)/i.test(lower)) return 'find_nearby';
  if (/(\bnie\b|zmien|zmień|\binne\b|cos innego|pokaz inne)/i.test(lower)) return 'change_restaurant';
  if (/(polec|polecasz|co polecasz|co warto)/i.test(lower)) return 'recommend';
  if (/(na szybko|cos szybkiego|szybkie jedzenie)/i.test(lower)) return 'find_nearby';
  if (/(mam ochote|chce cos|szukam czegos)/i.test(lower)) return 'find_nearby';
  if (/(co jest dostepne|co w poblizu|co w okolicy)/i.test(lower)) return 'find_nearby';
  if (/(zamów tutaj|zamow tu|chcę to zamówić)/i.test(lower)) return 'create_order';
  if (/(menu|karta|co mają|zobacz co)/i.test(lower)) return 'menu_request';
  
  if (intent === 'none' && /(restaurac|zjesc|jedzenie|posilek|obiad)/i.test(lower)) {
    return 'find_nearby';
  }
  
  return intent;
}

// ============================================================================
// INTENT HANDLERS
// ============================================================================

async function handleFindNearby(text, session) {
  const location = extractLocation(text);
  const cuisineType = extractCuisineType(text);
  let restaurants = null;
  
  if (location) {
    restaurants = await findRestaurantsByLocation(location, cuisineType);
    if (restaurants) {
      updateSession(session, { last_location: location });
    }
  }
  
  if (!restaurants) {
    let query = supabase
      .from("restaurants")
      .select("id,name,address,city,cuisine_type");
    
    if (cuisineType) {
      const cuisineList = expandCuisineType(cuisineType);
      if (cuisineList?.length > 1) {
        query = query.in('cuisine_type', cuisineList);
      } else if (cuisineList?.length === 1) {
        query = query.eq('cuisine_type', cuisineList[0]);
      }
    }
    
    const { data, error } = await query.limit(5);
    if (error) return "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
    restaurants = data;
  }
  
  if (!restaurants?.length) {
    if (cuisineType === 'wege') {
      return `Nie mam niestety opcji wegetariańskich w tej okolicy. Mogę sprawdzić coś innego?`;
    }
    if (cuisineType && location) {
      const nearbyCities = NEARBY_CITY_SUGGESTIONS[normalize(location)];
      if (nearbyCities?.length) {
        return `Nie widzę nic z kategorii "${cuisineType}" w ${location}, ale 5 minut dalej w ${nearbyCities[0]} mam kilka ciekawych miejsc — sprawdzimy?`;
      }
      return `Nie mam nic z kategorii "${cuisineType}" w ${location}. Chcesz zobaczyć inne opcje w tej okolicy?`;
    }
    return "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub lokalizację.";
  }
  
  const requestedCount = /pokaz\s+(wszystkie|5|wiecej)/i.test(text) ? restaurants.length : Math.min(3, restaurants.length);
  const displayRestaurants = restaurants.slice(0, requestedCount);
  const categories = groupRestaurantsByCategory(displayRestaurants);
  const categoryNames = Object.keys(categories);
  
  if (cuisineType) {
    const locationInfo = location ? ` w ${location}` : ' w pobliżu';
    const countText = displayRestaurants.length === 1 ? 'miejsce' :
                     displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';
    return `Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
      displayRestaurants.map((r, i) =>
        `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${r.city ? ` (${r.city})` : ''}`
      ).join('\n') +
      (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
      '\n\nKtóre Cię interesuje?';
  } else if (categoryNames.length > 1 && displayRestaurants.length >= 3) {
    const locationName = location || 'pobliżu';
    const categoryList = categoryNames.map(c => getCuisineFriendlyName(c)).join(', ');
    return `W ${locationName} mam kilka miejscówek — chcesz coś szybkiego jak burger czy raczej normalny obiad?\n` +
      `Mam ${categoryList} — co Ci chodzi po głowie?`;
  } else {
    const locationInfo = location ? ` w ${location}` : ' w pobliżu';
    const countText = displayRestaurants.length === 1 ? 'miejsce' :
                     displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';
    return `Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
      displayRestaurants.map((r, i) =>
        `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${r.city ? ` (${r.city})` : ''}`
      ).join('\n') +
      (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
      '\n\nKtóre Cię interesuje?';
  }
}

async function handleMenuRequest(parsed, session, prevLocation) {
  let verifiedRestaurant = null;
  if (parsed.restaurant) {
    verifiedRestaurant = await findRestaurant(parsed.restaurant);
    if (verifiedRestaurant) {
      updateSession(session, { lastRestaurant: verifiedRestaurant });
    } else {
      const fallback = await getLocationFallback(
        prevLocation,
        `Nie znalazłam "${parsed.restaurant}", ale w {location} mam:\n{list}\n\nKtórą wybierasz?`
      );
      return fallback || `Nie znalazłam restauracji o nazwie "${parsed.restaurant}". Możesz wybrać z tych, które są w pobliżu?`;
    }
  }
  
  const current = verifiedRestaurant || getSession(session)?.lastRestaurant;
  if (!current) {
    const fallback = await getLocationFallback(
      prevLocation,
      `W {location} mam {count} restauracji. Którą wybierasz?\n{list}`
    );
    return fallback || "Najpierw podaj nazwę restauracji.";
  }
  
  const { data: menu, error } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available")
    .eq("restaurant_id", current.id)
    .eq("is_available", true)
    .order("name", { ascending: true })
    .limit(6);
  
  if (error) return "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
  if (!menu?.length) {
    return `W bazie nie ma pozycji menu dla ${current.name}. Mogę:\n1) pokazać podobne lokale,\n2) dodać szybki zestaw przykładowych pozycji do testów.\nCo wybierasz?`;
  }
  
  updateSession(session, { last_menu: menu });
  return `W ${current.name} dostępne m.in.: ` +
    menu.map(m => `${m.name} (${Number(m.price).toFixed(2)} zł)`).join(", ") +
    ". Co chciałbyś zamówić?";
}

async function handleSelectRestaurant(restaurant, parsed, session) {
  const name = restaurant?.name || parsed.restaurant || "";
  if (!name) return "Podaj pełną nazwę restauracji.";
  
  const matched = await findRestaurant(name);
  if (!matched) {
    return `Nie znalazłam restauracji o nazwie „${name}". Mogę zaproponować miejsca w pobliżu.`;
  }
  
  updateSession(session, { lastRestaurant: matched });
  return `Wybrano restaurację ${matched.name}${matched.city ? ` (${matched.city})` : ''}. Możemy przejść do menu albo od razu coś zamówić.`;
}

async function handleCreateOrder(parsedOrder, text, session, prevLocation) {
  if (parsedOrder?.any) {
    const firstGroup = parsedOrder.groups[0];
    const targetRestaurant = await findRestaurant(firstGroup.restaurant_name);
    
    if (!targetRestaurant) {
      return { reply: `Nie mogę znaleźć restauracji ${firstGroup.restaurant_name}. Spróbuj ponownie.`, parsed_order: null };
    }
    
    updateSession(session, { lastRestaurant: targetRestaurant });
    const total = firstGroup.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemsList = firstGroup.items.map(item =>
      `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
    ).join(', ');
    
    return {
      reply: `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
      parsed_order: {
        restaurant: {
          id: targetRestaurant.id,
          name: targetRestaurant.name,
          city: targetRestaurant.city
        },
        items: firstGroup.items.map(item => ({
          id: item.menuItemId,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        })),
        total
      }
    };
  }
  
  const parsed = parseRestaurantAndDish(text);
  let targetRestaurant = null;
  if (parsed.restaurant) {
    targetRestaurant = await findRestaurant(parsed.restaurant);
    if (targetRestaurant) updateSession(session, { lastRestaurant: targetRestaurant });
  }
  
  const current = targetRestaurant || getSession(session)?.lastRestaurant;
  if (!current) {
    const fallback = await getLocationFallback(
      prevLocation,
      `Najpierw wybierz restaurację w {location}:\n{list}\n\nZ której chcesz zamówić?`
    );
    return { reply: fallback || "Najpierw wybierz restaurację, zanim złożysz zamówienie.", parsed_order: null };
  }
  
  const parsedItems = await parseOrderItems(text, current.id);
  if (parsedItems.length === 0) {
    const { data: menu } = await supabase
      .from('menu_items')
      .select('name, price')
      .eq('restaurant_id', current.id)
      .limit(5);
    
    if (menu?.length) {
      return { reply: `Nie rozpoznałam dania. W ${current.name} mamy: ${menu.map(m => m.name).join(', ')}. Co chcesz zamówić?`, parsed_order: null };
    }
    return { reply: `Nie rozpoznałam dania. Sprawdź menu ${current.name} i spróbuj ponownie.`, parsed_order: null };
  }
  
  const total = parsedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const itemsList = parsedItems.map(item =>
    `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
  ).join(', ');
  
  return {
    reply: `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
    parsed_order: {
      restaurant: { id: current.id, name: current.name, city: current.city },
      items: parsedItems,
      total
    }
  };
}

async function handleRecommend(text) {
  const cuisineType = extractCuisineType(text);
  let query = supabase
    .from('restaurants')
    .select('id, name, address, city, cuisine_type, rating, lat, lng')
    .order('rating', { ascending: false });
  
  if (cuisineType) {
    const cuisineList = expandCuisineType(cuisineType);
    if (cuisineList?.length > 1) {
      query = query.in('cuisine_type', cuisineList);
    } else if (cuisineList?.length === 1) {
      query = query.eq('cuisine_type', cuisineList[0]);
    }
  }
  
  const { data: topRestaurants, error } = await query.limit(3);
  if (error || !topRestaurants?.length) {
    return "Nie mogę teraz polecić restauracji. Spróbuj ponownie.";
  }
  
  if (topRestaurants.length === 1) {
    const r = topRestaurants[0];
    return `Mam coś idealnego — ${r.name}${r.rating ? `, ocena ${r.rating} ⭐` : ''}${r.cuisine_type ? `, ${getCuisineFriendlyName(r.cuisine_type)}` : ''}. Serio dobre miejsce!`;
  } else if (cuisineType === 'pizza' || cuisineType === 'Włoska') {
    const top = topRestaurants[0];
    return `Jeśli chcesz pizzę, polecam ${top.name}${top.rating ? ` (${top.rating} ⭐)` : ''} — serio dobra. ` +
      (topRestaurants.length > 1 ? `Mam też ${topRestaurants.slice(1).map(r => r.name).join(' i ')}.` : '');
  } else {
    const cuisineInfo = cuisineType ? ` z kategorii ${cuisineType}` : '';
    return `Polecam te miejsca${cuisineInfo}:\n` +
      topRestaurants.map((r, i) =>
        `${i+1}. ${r.name}${r.rating ? ` ⭐ ${r.rating}` : ''}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`
      ).join('\n') +
      '\n\nKtóre Cię interesuje?';
  }
}

async function handleChangeRestaurant(prevLocation) {
  if (prevLocation) {
    const otherRestaurants = await findRestaurantsByLocation(prevLocation);
    if (otherRestaurants?.length) {
      const categories = groupRestaurantsByCategory(otherRestaurants);
      const categoryNames = Object.keys(categories);
      
      if (categoryNames.length > 1 && otherRestaurants.length >= 3) {
        const categoryList = categoryNames.map(c => getCuisineFriendlyName(c)).join(', ');
        return `Mam kilka opcji w ${prevLocation} — ${categoryList}. Co Cię kręci?`;
      } else {
        return `Inne miejsca w ${prevLocation}:\n` +
          otherRestaurants.slice(0, 3).map((r, i) => `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n') +
          '\n\nKtóre wybierasz?';
      }
    }
    return "Nie znalazłam innych restauracji w tej okolicy. Podaj inną lokalizację.";
  }
  return "Jaką lokalizację chcesz sprawdzić?";
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        ok: false,
        reply: "Błąd połączenia z bazą danych. Spróbuj ponownie za chwilę.",
      });
    }

    const body = await req.json?.() || req.body || {};
    const { sessionId = "default", text } = body;
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    const session = getSession(sessionId) || {};
    const prevRestaurant = session?.lastRestaurant;
    const prevLocation = session?.last_location;

    // GeoContext Layer (early return)
    const geoLocation = extractLocation(text);
    const geoCuisineType = extractCuisineType(text);

    if (geoLocation) {
      const geoRestaurants = await findRestaurantsByLocation(geoLocation, geoCuisineType);

      if (geoRestaurants?.length) {
        updateSession(sessionId, {
          last_location: geoLocation,
          lastIntent: 'find_nearby',
          lastUpdated: Date.now()
        });

        const cuisineInfo = geoCuisineType ? ` serwujących ${geoCuisineType}` : '';
        const countText = geoRestaurants.length === 1 ? '1 restaurację' : `${geoRestaurants.length} restauracji`;
        const geoReply = `W ${geoLocation} znalazłam ${countText}${cuisineInfo}:\n` +
          geoRestaurants.map((r, i) =>
            `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`
          ).join('\n') +
          '\n\nKtórą chcesz wybrać?';

        return res.status(200).json({
          ok: true,
          intent: 'find_nearby',
          location: geoLocation,
          restaurants: geoRestaurants,
          reply: geoReply,
          confidence: 0.85,
          fallback: false,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Intent detection
    const currentSession = getSession(sessionId);
    const { intent: rawIntent, restaurant, parsedOrder, confidence: rawConfidence } = await detectIntent(text, currentSession);
    
    let intent = rawIntent;
    if (!parsedOrder?.any) {
      const boostedIntent = boostIntent(text, rawIntent, rawConfidence || 0.5);
      intent = boostedIntent;
    }

    const parsed = parseRestaurantAndDish(text);

    updateSession(sessionId, {
      lastIntent: intent,
      lastRestaurant: restaurant || prevRestaurant || null,
      lastUpdated: Date.now(),
    });

    let replyCore = "";
    let parsedOrderData = null;

    // Route intent
    switch (intent) {
      case "find_nearby":
        replyCore = await handleFindNearby(text, sessionId);
        break;
      case "menu_request":
        replyCore = await handleMenuRequest(parsed, sessionId, prevLocation);
        break;
      case "select_restaurant":
        replyCore = await handleSelectRestaurant(restaurant, parsed, sessionId);
        break;
      case "create_order": {
        const result = await handleCreateOrder(parsedOrder, text, sessionId, prevLocation);
        replyCore = result.reply;
        parsedOrderData = result.parsed_order;
        break;
      }
      case "recommend":
        replyCore = await handleRecommend(text);
        break;
      case "confirm":
        replyCore = prevRestaurant 
          ? `Super! Przechodzę do menu ${prevRestaurant.name}. Co chcesz zamówić?`
          : "Okej! Co robimy dalej?";
        break;
      case "change_restaurant":
        replyCore = await handleChangeRestaurant(prevLocation);
        break;
      default:
        if (prevRestaurant) {
          replyCore = `Chcesz zobaczyć menu restauracji ${prevRestaurant.name}${prevLocation ? ` w ${prevLocation}` : ''}?`;
        } else if (prevLocation) {
          replyCore = `Chcesz zobaczyć restauracje w ${prevLocation}? Powiedz "pokaż restauracje" lub wybierz konkretną nazwę.`;
        } else {
          replyCore = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
        }
    }

    // Early return for create_order with parsed_order
    if (intent === 'create_order' && parsedOrderData) {
      return res.status(200).json({
        ok: true,
        intent: 'create_order',
        restaurant: parsedOrderData.restaurant,
        parsed_order: parsedOrderData,
        reply: replyCore,
        confidence: 0.9,
        fallback: false,
        context: getSession(sessionId),
        timestamp: new Date().toISOString(),
      });
    }

    // Amber stylistic layer
    const amberCompletion = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 300,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
        messages: [
          {
            role: "system",
            content: `Jesteś Amber — asystentką FreeFlow, która pomaga użytkownikom zamawiać jedzenie.

WAŻNE ZASADY:
1. Jesteś ASYSTENTEM, nie klientem — nie mów "ja chcę", "odwiedziłabym"
2. Przepisz poniższą odpowiedź w swoim stylu, ale ZACHOWAJ WSZYSTKIE DANE (nazwy, menu, ceny, adresy)
3. Jeśli dostajesz listę — pokaż CAŁĄ listę, nie wybieraj za użytkownika
4. Mów naturalnie, krótko i bezpośrednio — jak człowiek, nie bot
5. Zamiast list wypunktowanych — używaj lekkiej narracji

STYL:
✅ "W Piekarach mam kilka miejscówek — burger czy normalny obiad?"
✅ "Mam fast-foody, pizzerie — co Ci chodzi po głowie?"
✅ "Jeśli chcesz pizzę, polecam Monte Carlo, serio dobra."
❌ "W Piekary znalazłam 9 restauracji: ..."
❌ "Z chęcią odwiedziłabym..."`,
          },
          { role: "user", content: `Przepisz w swoim stylu (krótko, naturalnie), zachowując WSZYSTKIE dane:\n\n${replyCore}` },
        ],
      }),
    });

    const amberData = await amberCompletion.json();
    const reply = amberData.choices?.[0]?.message?.content?.trim() || replyCore || "Nie mam teraz odpowiedzi.";

    // Anti-bullshit watchdog
    const sanitizedReply = (reply || "").trim();
    const isBrokenReply =
      !sanitizedReply ||
      sanitizedReply.length < 12 ||
      /(tak, chętnie|oczywiście|świetny wybór|z przyjemnością|miło mi|nie jestem pewna)/i.test(sanitizedReply);

    if (isBrokenReply) {
      if (!res.headersSent) {
        return res.status(200).json({
          ok: true,
          intent: intent || "none",
          restaurant: restaurant || prevRestaurant || null,
          reply: null,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }
    }

    const finalRestaurant = currentSession?.lastRestaurant || restaurant || prevRestaurant || null;
    const confidence = intent === 'none' ? 0 : (finalRestaurant ? 0.9 : 0.6);
    const fallback = intent === 'none' || !reply;

    return res.status(200).json({
      ok: true,
      intent,
      restaurant: finalRestaurant,
      reply,
      confidence,
      fallback,
      context: getSession(sessionId),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("🧠 brainRouter error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

