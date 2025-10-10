import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// Initialize TTS client
let ttsClient;

// Initialize TTS client with credentials
function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log('✅ TTS: Using Vercel environment credentials (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      ttsClient = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log('✅ TTS: Using Vercel environment credentials (Base64)');
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      const credentials = JSON.parse(credentialsJson);
      ttsClient = new TextToSpeechClient({ credentials });
    } else {
      console.log('✅ TTS: Using local service account file...');
      ttsClient = new TextToSpeechClient({
        keyFilename: './service-account.json'
      });
    }
  } catch (error) {
    console.error('❌ TTS: Failed to initialize client:', error);
    throw error;
  }

  return ttsClient;
}

// Polish voice configurations
const POLISH_VOICES = {
  'pl-PL-Wavenet-A': { name: 'pl-PL-Wavenet-A', gender: 'FEMALE' },
  'pl-PL-Wavenet-B': { name: 'pl-PL-Wavenet-B', gender: 'MALE' },
  'pl-PL-Wavenet-C': { name: 'pl-PL-Wavenet-C', gender: 'FEMALE' },
  'pl-PL-Wavenet-D': { name: 'pl-PL-Wavenet-D', gender: 'MALE' },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { 
      text, 
      lang = 'pl-PL', 
      voiceName = 'pl-PL-Wavenet-A', 
      audioEncoding = 'MP3', 
      speakingRate = 1.0, 
      pitch = 0.0, 
      volumeGainDb = 0.0 
    } = body;

    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    console.log('🎤 TTS Request:', { text: text.substring(0, 100), lang, voiceName });

    const client = initializeTtsClient();

    const request = {
      input: { text },
      voice: { languageCode: lang, name: voiceName },
      audioConfig: {
        audioEncoding: audioEncoding,
        speakingRate,
        pitch,
        volumeGainDb
      }
    };

    console.log('🔄 Sending request to Google Cloud TTS...');
    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error('No audio content received from Google Cloud TTS');
    }

    // ✅ Correct media type for MP3 audio
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(Buffer.from(response.audioContent, 'base64'));
    console.log('✅ TTS synthesis completed successfully');

  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({
      ok: false,
      error: 'TTS_ERROR',
      message: err.message,
    });
  }
}
