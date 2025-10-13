import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { applyCORS } from './_cors.js';

let ttsClient;

function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    let credentials;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_JSON");
      credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_BASE64");
      const decoded = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    } else {
      console.warn("⚠ No Google credentials found, using local file");
      const fs = require('fs');
      const path = require('path');
      const credentialsPath = path.join(process.cwd(), 'service-account.json');
      if (fs.existsSync(credentialsPath)) {
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      } else {
        throw new Error('No Google credentials found');
      }
    }

    ttsClient = new TextToSpeechClient({ credentials });
    return ttsClient;
  } catch (error) {
    console.error('❌ Failed to initialize TTS client:', error);
    throw error;
  }
}

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

    const client = initializeTtsClient();

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

    const [response] = await client.synthesizeSpeech(request);
    const audioBuffer = Buffer.from(response.audioContent);

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
