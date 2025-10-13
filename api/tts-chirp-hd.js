import { applyCORS } from './_cors.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Studio-B' } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });

    console.log('🎧 Chirp HD TTS request:', { text: text.substring(0, 50) + '...', voice, languageCode });

    // Dekoduj klucz serwisowy Base64 (z Vercela lub Vertex)
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
      voice: { languageCode, name: voice, model: 'chirp-3-hd' },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.92,
        pitch: -1.0,
        volumeGainDb: 2.0,
        effectsProfileId: ['studio-quality'],
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
    
    console.log('✅ Chirp HD TTS generated:', audioBuffer.length, 'bytes');
    res.status(200).end(audioBuffer);
  } catch (err) {
    console.error('❌ Chirp HD Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
