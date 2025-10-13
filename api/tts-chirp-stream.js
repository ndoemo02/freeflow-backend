// /api/tts-chirp-stream.js - Google Chirp Live Stream with Adaptive Tone
import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { text, tone } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text parameter" });
    }

    // Adaptive tone parameters for live streaming
    const pitch = tone === "swobodny" ? 2.5 : tone === "formalny" ? -0.5 : 0.5;
    const speakingRate = tone === "swobodny" ? 1.2 : tone === "formalny" ? 0.9 : 1.05;
    
    console.log('🎤 Live Stream TTS with tone:', { tone, pitch, speakingRate });

    const token = await getVertexAccessToken();
    
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
      console.error('❌ Chirp Live Stream TTS API error:', response.status, errorText);
      return res.status(500).json({ error: "Chirp Live Stream TTS failed" });
    }

    const result = await response.json();
    const audioContent = result.audioContent;
    const buffer = Buffer.from(audioContent, "base64");

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("🔥 Chirp Live Stream TTS Error:", e);
    res.status(500).json({ error: "Chirp Live Stream TTS failed" });
  }
}