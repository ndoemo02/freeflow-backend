import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// Initialize TTS client
let ttsClient;

// Initialize TTS client with credentials
function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Production: Use Vercel environment variable (JSON)
      console.log('✅ TTS: Using Vercel environment credentials (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      ttsClient = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      // Production: Use Vercel environment variable (Base64)
      console.log('✅ TTS: Using Vercel environment credentials (Base64)');
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      const credentials = JSON.parse(credentialsJson);
      ttsClient = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_CREDENTIALS_PART1 && process.env.GOOGLE_CREDENTIALS_PART2) {
      // Production: Use Vercel environment variable (Split JSON)
      console.log('✅ TTS: Using Vercel environment credentials (Split)');
      const credentialsJson = process.env.GOOGLE_CREDENTIALS_PART1 + process.env.GOOGLE_CREDENTIALS_PART2;
      const credentials = JSON.parse(credentialsJson);
      ttsClient = new TextToSpeechClient({ credentials });
    } else {
      // Local development fallback
      console.log('⚠️ TTS: Using local service account - tylko do testów lokalnych!');
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
  'pl-PL-Standard-A': { name: 'pl-PL-Standard-A', gender: 'FEMALE' },
  'pl-PL-Standard-B': { name: 'pl-PL-Standard-B', gender: 'MALE' },
  'pl-PL-Standard-C': { name: 'pl-PL-Standard-C', gender: 'FEMALE' },
  'pl-PL-Standard-D': { name: 'pl-PL-Standard-D', gender: 'MALE' }
};

export default async function tts(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, lang = 'pl-PL', voiceName, gender, audioEncoding = 'MP3' } = req.body;

    if (!text) {
      return res.status(400).json({ 
        error: 'Missing text parameter' 
      });
    }

    console.log('🎤 TTS Request:', { text: text.substring(0, 100) + '...', lang, voiceName, gender });

    // Initialize TTS client
    const client = initializeTtsClient();

    // Determine voice configuration
    let voiceConfig;
    if (voiceName && POLISH_VOICES[voiceName]) {
      voiceConfig = POLISH_VOICES[voiceName];
    } else if (gender) {
      // Find a voice by gender preference
      const genderVoices = Object.values(POLISH_VOICES).filter(v => v.gender === gender.toUpperCase());
      voiceConfig = genderVoices[0] || POLISH_VOICES['pl-PL-Wavenet-A'];
    } else {
      // Default to a good Polish voice
      voiceConfig = POLISH_VOICES['pl-PL-Wavenet-A'];
    }

    // Validate and normalize audio encoding
    const validEncodings = ['MP3', 'LINEAR16', 'OGG_OPUS'];
    const normalizedEncoding = validEncodings.includes(audioEncoding) ? audioEncoding : 'MP3';
    
    console.log('🎵 Audio encoding:', normalizedEncoding);

    // Configure the request
    const request = {
      input: { text: text },
      voice: {
        languageCode: lang,
        name: voiceConfig.name,
        ssmlGender: voiceConfig.gender
      },
      audioConfig: {
        audioEncoding: normalizedEncoding,
        speakingRate: speakingRate || 1.0,
        pitch: pitch || 0.0,
        volumeGainDb: volumeGainDb || 0.0
      }
    };

    console.log('🔄 Sending to Google Cloud TTS...');
    console.log('📋 Request config:', JSON.stringify(request, null, 2));
    
    // Perform the text-to-speech request
    const [response] = await client.synthesizeSpeech(request);
    
    if (!response.audioContent) {
      throw new Error('No audio content received from Google Cloud TTS');
    }
    
    // Convert audio content to base64
    const audioContent = response.audioContent.toString('base64');
    
    console.log('✅ TTS synthesis completed, audio size:', audioContent.length);

    res.status(200).json({
      ok: true,
      audioContent: audioContent,
      audioEncoding: normalizedEncoding,
      voice: voiceConfig.name,
      language: lang,
      textLength: text.length
    });

  } catch (error) {
    console.error('❌ TTS error:', error);
    
    // Return a more detailed error response
    const errorResponse = {
      ok: false,
      error: 'TTS_ERROR',
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    };

    // Handle specific Google Cloud errors
    if (error.code === 7) {
      errorResponse.message = 'Permission denied. Check Google Cloud credentials.';
    } else if (error.code === 3) {
      errorResponse.message = 'Invalid argument. Check text content and voice parameters.';
    } else if (error.code === 8) {
      errorResponse.message = 'Resource exhausted. TTS quota exceeded.';
    }

    res.status(500).json(errorResponse);
  }
}