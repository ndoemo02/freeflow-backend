// /api/business-categories.js — endpoint do pobierania kategorii biznesu
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ 
      ok: false, 
      error: "METHOD_NOT_ALLOWED", 
      message: "Tylko metoda GET jest obsługiwana" 
    });
  }

  try {
    // Pobieranie wszystkich aktywnych kategorii biznesu
    const { data: categories, error: categoriesError } = await supabase
      .from('business_categories')
      .select('id, name, display_name, description, icon_name')
      .eq('is_active', true)
      .order('display_name');

    if (categoriesError) {
      console.error('Categories fetch error:', categoriesError);
      return res.status(500).json({
        ok: false,
        error: "CATEGORIES_FETCH_ERROR",
        message: "Nie udało się pobrać kategorii biznesu",
        details: categoriesError.message
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Kategorie biznesu pobrane pomyślnie",
      data: {
        categories: categories || [],
        total_count: categories?.length || 0
      }
    });

  } catch (err) {
    console.error("BUSINESS_CATEGORIES error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: "BUSINESS_CATEGORIES_INTERNAL", 
      message: "Błąd wewnętrzny serwera",
      detail: String(err?.message || err) 
    });
  }
}
