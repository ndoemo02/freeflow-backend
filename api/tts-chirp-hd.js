// /api/tts-chirp-hd.js - Google Chirp HD with Adaptive Tone
import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';

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

    console.log('🎤 Chirp HD TTS (Vertex AI 2025) with tone:', { tone, pitch, speakingRate });

    const token = await getVertexAccessToken();
    
    // Vertex AI TTS endpoint (2025) - standardowe API
    const response = await fetch(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: "pl-PL",
            name: "pl-PL-Wavenet-A" // Erinome (Female) - głos żeński HD
          },
          audioConfig: {
            audioEncoding: "MP3",
            pitch,
            speakingRate,
            effectsProfileId: ["headphone-class-device"] // Lepszej jakości dla Chirp HD
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Chirp HD TTS API error:', response.status, errorText);
      return res.status(500).json({ error: "Chirp HD TTS failed" });
    }

    const result = await response.json();
    const audioContent = result.audioContent;
    const buffer = Buffer.from(audioContent, "base64");

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("🔥 Chirp HD TTS Error:", e);
    res.status(500).json({ error: "Chirp HD TTS failed" });
  }
}