// /api/tts.js - Google Chirp HD with Adaptive Tone
import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getConfig } from "./config/configService.js";

// Global Supabase client (avoid per-call instantiation)
export const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

let openaiClient = null;
// Simple in-memory cache (LRU up to 10 entries)
const ttsCache = new Map();
// Cache dla krótkiej stylizacji GPT-4o (max 20 wpisów)
const stylizeCache = new Map();

// --- Gemini TTS helper (experimental) ---
async function playGeminiTTS(text, { voice, pitch, speakingRate }) {
  const accessToken = await getVertexAccessToken();
  const projectId =
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;
  // Generative modele Gemini zwykle działają w lokalizacji "global"
  const location =
    process.env.GEMINI_TTS_LOCATION ||
    process.env.GOOGLE_VERTEX_LOCATION ||
    "global";
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-pro-tts";

  if (!projectId) {
    throw new Error("Brak GOOGLE_PROJECT_ID / GCLOUD_PROJECT dla Gemini TTS");
  }

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  // Minimalny, wspierany payload: tylko treść i typ odpowiedzi audio.
  // Głos/tempo będą na razie domyślne po stronie Gemini.
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: String(text || "") }],
      },
    ],
    generationConfig: {
      responseMimeType: "audio/mp3",
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("❌ Gemini TTS error:", res.status, txt);
    throw new Error(`Gemini TTS failed: ${res.status}`);
  }

  const json = await res.json();
  // Szukamy audio w odpowiedzi (inlineData)
  const candidate = (json.candidates || [])[0];
  const parts = candidate?.content?.parts || [];
  const audioPart = parts.find(
    (p) => p.inlineData && /^audio\//.test(p.inlineData.mimeType || "")
  );
  const data = audioPart?.inlineData?.data;
  if (!data) {
    console.warn("⚠️ Gemini TTS: no audio data in response");
  }
  return data || "";
}

export function clearTtsCaches() {
  try { ttsCache.clear(); } catch {}
  try { stylizeCache.clear(); } catch {}
}
function getOpenAI() {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// Pre-formatter: porządkuje tekst zanim trafi do modelu/TTS (usuwa duplikaty typu
// "hotel hotel", zamienia przecinki na pauzy w mowie itp.)
export function refineSpeechText(text, intent) {
  try {
    if (!text) return text;
    // usuń zbędne zwroty „hotel/restauracja jest”
    text = text.replace(/,?\s*(hotel|restauracja)\s+jest/gi, ' – około').replace(/\s{2,}/g, ' ');
    // przecinki → myślniki (pauzy)
    text = text.replace(/,\s*/g, ' – ').replace(/– –/g, ' – ');
    // metry → metry stąd
    text = text.replace(/(\d+)\s*metr(y|ów)/gi, '$1 metr$2 stąd');
    if (intent === 'find_nearby') {
      text = text.replace(/^W pobliżu mam[:]?/i, 'Znalazłam kilka miejsc w pobliżu:').replace(/\b(\d+)\.\s*/g, '').replace(/\s{2,}/g, ' ');
    }
    // usuń duplikaty generików nazw
    text = text.replace(/\b(burger|hamburger)\b(?:\s+\1\b)+/gi, '$1');
    text = text.replace(/\b(hotel|pizzeria|restauracja|bar)\b(?:\s+\1\b)+/gi, '$1');
    try { text = text.replace(/\b([\p{L}]{2,})\b(?:\s+\1\b)+/giu, '$1'); } catch {}
    return text.trim();
  } catch { return text; }
}

// Buduje prosty SSML: <speak>…</speak> + pauzy
export function applySSMLStyling(reply, intent = 'neutral') {
  try {
    let raw = typeof reply === 'string' ? reply.trim() : '';
    if (!raw) return reply;
    if (/<\s*speak[\s>]/i.test(raw)) return raw; // już SSML
    raw = refineSpeechText(raw, intent) || raw;
    raw = raw.replace(/\s*,\s*/g, ', <break time="250ms"/> ');
    raw = raw.replace(/\s+oraz\s+/gi, ' <break time="250ms"/> oraz ');
    raw = raw.replace(/\s+i\s+/gi, ' <break time="250ms"/> i ');
    raw = raw.replace(/([\.!])\s+/g, '$1 <break time="250ms"/> ');
    return `<speak>${raw}</speak>`;
  } catch { return reply; }
}

// Używa GPT-4o do lekkiego przeredagowania (tylko styl), a potem stosuje SSML.
// W testach i bez klucza – zwraca tekst po preformaterze, bez SSML.
export async function formatTTSReply(rawText, intent = 'neutral') {
  try {
    if (!rawText || typeof rawText !== 'string') return rawText;
    const pre = refineSpeechText(rawText, intent);
    if (process.env.NODE_ENV === 'test') return pre;
    const openai = getOpenAI();
    if (!openai) return pre;
    const stylePrompts = {
      find_nearby: 'mów z entuzjazmem, jak doradca gastronomiczny – polecaj miejsca ciepło, ale konkretnie.',
      select_by_name: 'mów naturalnie, potwierdzająco, jakbyś wybierała coś w rozmowie.',
      confirm_order: 'mów spokojnie i profesjonalnie, z nutą serdeczności.',
      cancel_order: 'mów łagodnie, neutralnie – bez napięcia.',
      recommend: 'mów z lekko promocyjnym tonem, jakbyś znała te miejsca osobiście.',
      none: 'mów z zaciekawieniem i empatią, jakbyś chciała doprecyzować pytanie.',
    };
    const systemPrompt = `Jesteś Amber – głosem FreeFlow. Nie zmieniaj faktów – tylko ton wypowiedzi. Intencja: "${intent}". Styl: ${stylePrompts[intent] || 'mów naturalnie, jasno i przyjaźnie.'}`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: `Przeredaguj do mowy:
${pre}` } ]
    });
    const out = resp?.choices?.[0]?.message?.content?.trim();
    return out || pre;
  } catch (e) {
    console.error('formatTTSReply error:', e);
    return refineSpeechText(rawText, intent);
  }
}

// Krótka parafraza mówiona Amber – bez SSML, max 2 zdania, brak list i numeracji
export async function stylizeWithGPT4o(rawText, intent = 'neutral') {
  try {
    if (!rawText || typeof rawText !== 'string') return rawText;
    const model = process.env.OPENAI_MODEL;
    if (!model) return rawText;
    if (process.env.NODE_ENV === 'test') return rawText;
    const openai = getOpenAI();
    if (!openai) return rawText;
    const key = `${rawText}|${intent}`;
    if (stylizeCache.has(key)) return stylizeCache.get(key);
    let system = `Jesteś Amber – głosem FreeFlow. Przekształć surowy tekst w krótką, naturalną wypowiedź (max 2 zdania), ciepły lokalny ton, lekko dowcipny. Nie używaj list, numeracji ani nawiasów. Nie dodawaj informacji, nie używaj znaczników i SSML. Intencja: ${intent}.`;

    // Dynamiczne prompty / styl mowy
    try {
      const cfg = await getConfig();
      const style = (cfg?.speech_style || 'standard').toLowerCase();

      if (cfg?.amber_prompt && typeof cfg.amber_prompt === "string" && cfg.amber_prompt.trim().length > 0) {
        // Jeśli admin podał własny system prompt – użyj go 1:1
        system = cfg.amber_prompt;
      } else if (style === 'silesian' || style === 'śląska' || style === 'slask') {
        system = `Jesteś Amber – głosem FreeFlow. Przekształć surowy tekst w krótką, naturalną wypowiedź (max 2 zdania).
Mów przyjaźnie i jasno, ale używaj śląskiej gwary (gōdka) – lekkiej i zrozumiałej dla osób spoza regionu.
Unikaj bardzo rzadkich słów, nie przesadzaj z gwarą, tylko dodaj lokalny klimat (np. „joch”, „kaj”, „po naszymu”).
Nie zmieniaj faktów ani liczb. Intencja użytkownika: "${intent}".`;
      }
    } catch {}
    let out = '';
    if (process.env.OPENAI_STREAM === 'true') {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Przeredaguj na mowę rozmowną:\n${rawText}` }
        ],
        temperature: 0.6,
        stream: true
      });
      for await (const chunk of completion) {
        out += chunk?.choices?.[0]?.delta?.content || '';
      }
    } else {
      const resp = await openai.chat.completions.create({
        model,
        temperature: 0.6,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Przeredaguj na mowę rozmowną:\n${rawText}` }
        ]
      });
      out = resp?.choices?.[0]?.message?.content?.trim() || '';
    }
    if (!out) return rawText;
    // bezpieczeństwo: usuń potencjalne znaczniki
    const cleaned = out.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    stylizeCache.set(key, cleaned);
    if (stylizeCache.size > 20) stylizeCache.delete(stylizeCache.keys().next().value);
    return cleaned;
  } catch (e) {
    console.warn('stylizeWithGPT4o error:', e?.message || e);
    return rawText;
  }
}

// Funkcja do odtwarzania TTS (używana przez watchdog i inne moduły)
export async function playTTS(text, options = {}) {
  try {
    // 🔧 Dynamiczne ustawienia TTS z system_config
    let cfg;
    try {
      cfg = await getConfig();
    } catch {}

    const engineRaw = (cfg?.tts_engine?.engine || process.env.TTS_MODE || "vertex").toLowerCase();
    const voiceCfg = cfg?.tts_voice?.voice || process.env.TTS_VOICE || "pl-PL-Wavenet-A";
    const voice = options.voice || voiceCfg;

    // 🎚️ Ton + tempo z configu lub z parametru
    const cfgTone = (cfg?.tts_tone || "").toLowerCase();
    const toneRaw = (options.tone || cfgTone || "swobodny").toLowerCase();

    const SIMPLE = engineRaw === "basic" || engineRaw === "wavenet";
    const isGeminiTTS = engineRaw === "gemini-tts" || engineRaw === "gemini";
    const isGeminiLive = engineRaw === "gemini-live";
    const USE_VERTEX =
      engineRaw === "vertex" ||
      engineRaw === "chirp" ||
      (!isGeminiTTS && !isGeminiLive && process.env.TTS_USE_VERTEX !== "false");
    const USE_LINEAR16 = process.env.TTS_LINEAR16 === "true"; // eksperymentalnie (lokalnie)
    const isChirpHD = engineRaw === "chirp" || /Chirp3-HD/i.test(String(voice));

    const basePitch = toneRaw === "swobodny" ? 2 : toneRaw === "formalny" ? -1 : 0;
    const baseRate = toneRaw === "swobodny" ? 1.1 : toneRaw === "formalny" ? 0.95 : 1.0;

    const pitch =
      typeof cfg?.tts_pitch === "number"
        ? cfg.tts_pitch
        : basePitch;
    const speakingRate =
      typeof cfg?.tts_rate === "number"
        ? cfg.tts_rate
        : baseRate;

    console.log('[TTS]', 'Generating:', String(text || '').slice(0, 80) + '...');

    // Gemini TTS / Gemini Live – użyj osobnego endpointu generatywnego
    if (isGeminiTTS || isGeminiLive) {
      console.log(
        `[TTS] Using Gemini ${isGeminiLive ? "Live" : "2.5 Pro TTS"} voice: ${voice}`
      );
      const cacheKeyGemini = `${String(text)}|${voice}|${toneRaw}|gemini`;
      if (ttsCache.has(cacheKeyGemini)) return ttsCache.get(cacheKeyGemini);
      const audio = await playGeminiTTS(text, { voice, pitch, speakingRate });
      ttsCache.set(cacheKeyGemini, audio);
      if (ttsCache.size > 10) ttsCache.delete(ttsCache.keys().next().value);
      return audio;
    }

    // Użyj getVertexAccessToken zamiast bezpośredniego klucza API
    const accessToken = await getVertexAccessToken();
    if (SIMPLE || !USE_VERTEX) {
      const plain = String(text || '').replace(/<[^>]+>/g, '');
      const audioEnc = 'MP3';
      console.log(`🔊 Using BASIC TTS (${voice}, ${audioEnc})`);
      // Simple cache
      const cacheKey = `${plain}|${voice}|${toneRaw}`;
      if (ttsCache.has(cacheKey)) return ttsCache.get(cacheKey);
      const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: plain },
          voice: { languageCode: 'pl-PL', name: voice },
          // v1 API nie wspiera enableTimePointing – zawsze czysty MP3
          audioConfig: { audioEncoding: 'MP3' }
        })
      });
      if (!response.ok) {
        const t = await response.text().catch(()=> '');
        console.error('❌ BASIC TTS error:', response.status, t);
        throw new Error(`TTS API failed: ${response.status}`);
      }
      const result = await response.json();
      const audioContent = result.audioContent || '';
      ttsCache.set(cacheKey, audioContent);
      if (ttsCache.size > 10) ttsCache.delete(ttsCache.keys().next().value);
      return audioContent;
    }
    console.log('✅ Google access token obtained successfully');

    // Vertex AI TTS endpoint (2025) - standardowe API
    let endpoint = "https://europe-west1-texttospeech.googleapis.com/v1beta1/text:synthesize";
    let reqBody = {
      input: /<\s*speak[\s>]/i.test(text || '') ? { ssml: text } : { text },
      voice: { languageCode: "pl-PL", name: voice },
      // Bez enableTimePointing dla stabilności
      audioConfig: (isChirpHD ? { audioEncoding: 'MP3' } : { audioEncoding: 'MP3', pitch, speakingRate })
    };
    console.log('🔊 Using Vertex: ' + voice);
    const cacheKeyVertex = `${JSON.stringify(reqBody.input)}|${voice}|${toneRaw}`;
    if (ttsCache.has(cacheKeyVertex)) return ttsCache.get(cacheKeyVertex);
    let response = await fetch(
      endpoint,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(reqBody)
      }
    );

    // Fallback na Wavenet po 400/403/404 (i brak wsparcia pitch)
    if (!response.ok && (response.status === 400 || response.status === 403 || response.status === 404)) {
      console.warn(`⚠️ Vertex failed (${response.status}), switching to Wavenet-D`);
      endpoint = "https://texttospeech.googleapis.com/v1/text:synthesize";
      const payload = JSON.parse(JSON.stringify(reqBody));
      // Sanity: klasyczny TTS woli prosty text
      if (payload.input?.ssml) {
        payload.input.text = String(payload.input.ssml).replace(/<[^>]+>/g, "");
        delete payload.input.ssml;
      }
      // pitch/speakingRate obsługiwane – zostaw, ale usuń efekty
      // v1 fallback – bez enableTimePointing
      payload.audioConfig = { audioEncoding: 'MP3', pitch, speakingRate };
      payload.voice = { languageCode: "pl-PL", name: "pl-PL-Wavenet-D" };
      console.log('🔊 Using Wavenet: ' + payload.voice.name);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ playTTS API error:', response.status, errorText);
      throw new Error(`TTS API failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ TTS audio generated successfully');
    const audioContent = result.audioContent;
    const finalKey = endpoint.includes('europe-west1') ? cacheKeyVertex : `${String(text)}|${voice}|${toneRaw}`;
    ttsCache.set(finalKey, audioContent);
    if (ttsCache.size > 10) ttsCache.delete(ttsCache.keys().next().value);
    return audioContent; // base64
  } catch (e) {
    console.error("🔥 playTTS Error:", e.message);
    throw e;
  }
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { text, tone } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text parameter" });
    }

    // Ujednolicone wywołanie przez playTTS – korzysta z configu (głos, ton, tempo)
    const audioContent = await playTTS(text, { tone });
    const buffer = Buffer.from(audioContent, "base64");

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("🔥 TTS Error:", e);
    res.status(500).json({ error: "TTS failed" });
  }
}