import { applyCORS } from './_cors.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, voice = 'pl-PL-Standard-A', languageCode = 'pl-PL' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log('🔴 Chirp Live Stream TTS request:', { text: text.substring(0, 50) + '...', voice, languageCode });

    // Google Cloud Text-to-Speech API z Chirp Live Streaming
    const request = {
      input: { text },
      voice: {
        languageCode,
        name: 'pl-PL-Chirp-A', // Chirp model dla Live Streaming
        ssmlGender: 'FEMALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.1, // Slightly faster for live streaming
        pitch: 0.2, // Slightly higher pitch for live feel
        volumeGainDb: 2.0, // Louder for live streaming
        effectsProfileId: ['headphone-class-device'] // Optimized for live streaming
      }
    };

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Google TTS API error:', error);
      return res.status(500).json({ error: 'TTS synthesis failed' });
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-TTS-Mode', 'live-streaming'); // Custom header for live mode
    
    console.log('✅ Chirp Live Stream TTS generated:', audioBuffer.length, 'bytes');
    res.send(audioBuffer);

  } catch (error) {
    console.error('❌ Chirp Live Stream TTS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
