import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';

let ttsClient;

async function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    // Użyj dedykowanego modułu do autoryzacji
    const token = await getVertexAccessToken();
    
    // Dla Google Cloud Client potrzebujemy credentials, nie token
    // Więc używamy prostszego podejścia z bezpośrednim wywołaniem API
    ttsClient = { token }; // Symulujemy client z tokenem
    return ttsClient;
  } catch (error) {
    console.error('❌ Failed to initialize TTS client:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Standard-A' } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });

    console.log('🎧 Chirp HD TTS request:', { text: text.substring(0, 50) + '...', voice, languageCode });

    const client = await initializeTtsClient();

    // Bezpośrednie wywołanie Google TTS API z tokenem
    const requestBody = {
      input: { text },
      voice: {
        languageCode,
        name: voice,
        ssmlGender: 'FEMALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.92,
        pitch: -1.0,
        volumeGainDb: 2.0
      }
    };

    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Google TTS API error:', errorText);
      throw new Error(`TTS API error: ${response.statusText}`);
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    console.log('✅ Chirp HD TTS generated:', audioBuffer.length, 'bytes');
    res.status(200).end(audioBuffer);
  } catch (err) {
    console.error('❌ Chirp HD Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
