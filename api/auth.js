// /api/auth.js — endpoint logowania dla aplikacji FreeFlow
import { applyCors } from './cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ 
      ok: false, 
      error: "METHOD_NOT_ALLOWED", 
      message: "Tylko metoda POST jest obsługiwana" 
    });
  }

  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();

    // Walidacja podstawowa
    if (!email || !password) {
      return res.status(400).json({ 
        ok: false, 
        error: "MISSING_CREDENTIALS", 
        message: "Email i hasło są wymagane" 
      });
    }

    // Hardcoded użytkownik do testów
    const VALID_EMAIL = "ndoemo02@gmail.com";
    const VALID_PASSWORD = "abc123";

    if (email !== VALID_EMAIL || password !== VALID_PASSWORD) {
      return res.status(401).json({ 
        ok: false, 
        error: "INVALID_CREDENTIALS", 
        message: "Nieprawidłowy email lub hasło" 
      });
    }

    // Sukces logowania - generujemy prosty token
    const timestamp = Date.now();
    const token = `freeflow_${Buffer.from(`${email}_${timestamp}`).toString('base64')}`;
    
    return res.status(200).json({
      ok: true,
      message: "Logowanie pomyślne",
      data: {
        token,
        user: {
          email: VALID_EMAIL,
          id: 1,
          name: "Demo User"
        },
        expires: timestamp + (24 * 60 * 60 * 1000) // 24h
      }
    });

  } catch (err) {
    console.error("AUTH error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: "AUTH_INTERNAL", 
      message: "Błąd wewnętrzny serwera",
      detail: String(err?.message || err) 
    });
  }
}