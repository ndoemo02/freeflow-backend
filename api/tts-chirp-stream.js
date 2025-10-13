import { applyCORS } from './_cors.js';
import { getVertexAccessToken } from '../utils/googleAuth.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Standard-A' } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });

    console.log('🔴 Live Stream TTS request:', { text: text.substring(0, 50) + '...', voice, languageCode });

    // Użyj dedykowanego modułu do autoryzacji
    const token = await getVertexAccessToken();

    // Na razie używamy standardowego TTS API z parametrami dla live streaming
    // (WebSocket streaming wymaga dodatkowej konfiguracji)
    const requestBody = {
      input: { text },
      voice: {
        languageCode,
        name: voice,
        ssmlGender: 'FEMALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.1, // Slightly faster for live streaming
        pitch: 0.2, // Slightly higher pitch for live feel
        volumeGainDb: 2.0 // Louder for live streaming
      }
    };

    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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
    res.setHeader('X-TTS-Mode', 'live-streaming'); // Custom header for live mode
    
    console.log('✅ Live Stream TTS generated:', audioBuffer.length, 'bytes');
    res.status(200).end(audioBuffer);

  } catch (err) {
    console.error('❌ Live Stream TTS error:', err);
    res.status(500).json({ error: err.message });
  }
}

