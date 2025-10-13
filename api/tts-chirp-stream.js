import { applyCORS } from './_cors.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  console.log('🔴 Chirp Streaming TTS request:', { text: text.substring(0, 50) + '...' });

  try {
    // Na razie używamy standardowego TTS zamiast WebSocket
    // (WebSocket wymagałby dodatkowej konfiguracji dla Vercel)
    
    let credentials;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_BASE64");
      credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
      );
    } else if (process.env.GOOGLE_VOICEORDER_KEY_B64) {
      console.log("✅ Using GOOGLE_VOICEORDER_KEY_B64");
      credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_VOICEORDER_KEY_B64, 'base64').toString('utf8')
      );
    } else {
      throw new Error('No Google credentials found');
    }

    const endpoint = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

    const requestBody = {
      input: { text },
      voice: { 
        languageCode: 'pl-PL', 
        name: 'pl-PL-Studio-B', 
        model: 'chirp-3-hd' 
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.1, // Slightly faster for live streaming
        pitch: 0.2, // Slightly higher pitch for live feel
        volumeGainDb: 2.0, // Louder for live streaming
        effectsProfileId: ['headphone-class-device'] // Optimized for live streaming
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.private_key}`,
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
    
    console.log('✅ Chirp Streaming TTS generated:', audioBuffer.length, 'bytes');
    res.status(200).end(audioBuffer);

  } catch (err) {
    console.error('❌ Streaming error:', err);
    res.status(500).json({ error: err.message });
  }
}
