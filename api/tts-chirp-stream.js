import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { applyCORS } from './_cors.js';

let ttsClient;

async function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    let credentials;

    // Vercel: użyj GOOGLE_VOICEORDER_KEY_B64
    if (process.env.GOOGLE_VOICEORDER_KEY_B64) {
      console.log("✅ Using GOOGLE_VOICEORDER_KEY_B64 (Vercel)");
      const decoded = Buffer.from(process.env.GOOGLE_VOICEORDER_KEY_B64, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    }
    // Lokalnie: użyj GOOGLE_APPLICATION_CREDENTIALS
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS (local)");
      const fs = await import('fs');
      const path = await import('path');
      const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (fs.existsSync(credentialsPath)) {
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      } else {
        throw new Error(`Credentials file not found: ${credentialsPath}`);
      }
    }
    // Fallback: inne zmienne
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_JSON");
      credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_BASE64");
      const decoded = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    } else {
      console.warn("⚠ No Google credentials found, trying default paths");
      const fs = await import('fs');
      const path = await import('path');
      const defaultPaths = [
        path.join(process.cwd(), 'FreeFlow.json'),
        path.join(process.cwd(), 'service-account.json')
      ];
      
      for (const credentialsPath of defaultPaths) {
        if (fs.existsSync(credentialsPath)) {
          console.log(`✅ Using default credentials: ${credentialsPath}`);
          credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
          break;
        }
      }
      
      if (!credentials) {
        throw new Error('No Google credentials found in any location');
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

    console.log('🔴 Live Stream TTS request:', { text: text.substring(0, 50) + '...', voice, languageCode });

    const client = await initializeTtsClient();

    // Google Cloud Text-to-Speech API z Chirp Live Streaming
    const request = {
      input: { text },
      voice: {
        languageCode,
        name: 'pl-PL-Standard-A', // Standard Polish voice (Chirp not available)
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
    
    console.log('✅ Live Stream TTS generated:', audioBuffer.length, 'bytes');
    res.send(audioBuffer);

  } catch (error) {
    console.error('❌ Chirp Live Stream TTS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
