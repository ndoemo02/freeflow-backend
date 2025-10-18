// /api/tts.js - Google Chirp HD with Adaptive Tone
import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';

// Funkcja do odtwarzania TTS (używana przez watchdog i inne moduły)
export async function playTTS(text, options = {}) {
  try {
    const { voice = "pl-PL-Wavenet-D", tone = "neutral" } = options;
    const pitch = tone === "swobodny" ? 2 : tone === "formalny" ? -1 : 0;
    const speakingRate = tone === "swobodny" ? 1.1 : tone === "formalny" ? 0.95 : 1.0;

    console.log('🎤 playTTS called:', { text: text.substring(0, 50), voice, tone });

    // Użyj getVertexAccessToken zamiast bezpośredniego klucza API
    const accessToken = await getVertexAccessToken();
    console.log('✅ Google access token obtained successfully');

    const response = await fetch(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: "pl-PL",
            name: voice
          },
          audioConfig: {
            audioEncoding: "MP3",
            pitch,
            speakingRate
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ playTTS API error:', response.status, errorText);
      throw new Error(`TTS API failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ TTS audio generated successfully');
    return result.audioContent; // zwraca base64
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

    // Adaptive tone parameters
    const pitch = tone === "swobodny" ? 2 : tone === "formalny" ? -1 : 0;
    const speakingRate = tone === "swobodny" ? 1.1 : tone === "formalny" ? 0.95 : 1.0;
    
    console.log('🎤 TTS with tone:', { tone, pitch, speakingRate });

    // Użyj getVertexAccessToken zamiast bezpośredniego klucza API
    const accessToken = await getVertexAccessToken();
    console.log('✅ Using GOOGLE_VOICEORDER_KEY_B64 (Vercel/Cloud)');

    const response = await fetch(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: "pl-PL",
            name: "pl-PL-Wavenet-D" // Chirp HD damski
          },
          audioConfig: {
            audioEncoding: "MP3",
            pitch,
            speakingRate
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ TTS API error:', response.status, errorText);
      return res.status(500).json({ error: "TTS API failed" });
    }

    const result = await response.json();
    const audioContent = result.audioContent;
    const buffer = Buffer.from(audioContent, "base64");

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("🔥 TTS Error:", e);
    res.status(500).json({ error: "TTS failed" });
  }
}