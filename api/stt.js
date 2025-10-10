import { SpeechClient } from '@google-cloud/speech';
import multer from 'multer';

// Initialize Speech client
let speechClient;

function initializeSpeechClient() {
  if (speechClient) return speechClient;

  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log('✅ STT: Using Vercel environment credentials (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      speechClient = new SpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log('✅ STT: Using Vercel environment credentials (Base64)');
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      const credentials = JSON.parse(credentialsJson);
      speechClient = new SpeechClient({ credentials });
    } else {
      console.log('✅ STT: Using local service account file...');
      speechClient = new SpeechClient({
        keyFilename: './service-account.json'
      });
    }
  } catch (error) {
    console.error('❌ STT: Failed to initialize client:', error);
    throw error;
  }

  return speechClient;
}

// Configure multer for file uploads (memory storage for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/') || 
        file.mimetype === 'application/octet-stream' ||
        file.originalname.endsWith('.webm') ||
        file.originalname.endsWith('.wav') ||
        file.originalname.endsWith('.mp3')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// No file cleanup needed with memory storage

export default async function stt(req, res) {
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

  let uploadedFile = null;

  try {
    // Handle file upload
    await new Promise((resolve, reject) => {
      upload.single('audio')(req, res, (err) => {
        if (err) {
          console.error('❌ Upload error:', err);
          reject(err);
        } else {
          uploadedFile = req.file;
          resolve();
        }
      });
    });

    if (!uploadedFile) {
      return res.status(400).json({ 
        error: 'No audio file provided',
        message: 'Please provide an audio file in the request'
      });
    }

    console.log('🎤 STT Request:', {
      filename: uploadedFile.originalname,
      mimetype: uploadedFile.mimetype,
      size: uploadedFile.size
    });

    // --- 🔊 GOOGLE SPEECH TO TEXT INTEGRATION ---
    const speechClient = initializeSpeechClient();

    // Determine audio encoding based on file type
    let detectedEncoding = 'WEBM_OPUS';
    if (uploadedFile.mimetype.includes('wav')) {
      detectedEncoding = 'LINEAR16';
    } else if (uploadedFile.mimetype.includes('mp3')) {
      detectedEncoding = 'MP3';
    } else if (uploadedFile.mimetype.includes('flac')) {
      detectedEncoding = 'FLAC';
    }

    const audioBytes = uploadedFile.buffer.toString("base64");

    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: detectedEncoding || "WEBM_OPUS",
        sampleRateHertz: 16000,
        languageCode: "pl-PL",
        enableAutomaticPunctuation: true,
        model: "default",
      },
    };

    console.log("🎙 Sending audio to Google Cloud STT...");

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join(" ");

    if (!transcription) {
      return res.status(200).json({
        ok: false,
        error: "NO_SPEECH",
        message: "Nie wykryto mowy w nagraniu.",
      });
    }

    console.log("✅ Transkrypcja:", transcription);

    return res.status(200).json({
      ok: true,
      text: transcription,
      confidence: response.results[0].alternatives[0].confidence || null,
      language: "pl-PL",
      encoding: detectedEncoding,
    });
    // --- 🔚 END STT PATCH ---

  } catch (error) {
    console.error('❌ STT error:', error);
    
    // Return detailed error response
    const errorResponse = {
      ok: false,
      error: 'STT_ERROR',
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    };

    // Handle specific Google Cloud errors
    if (error.code === 7) {
      errorResponse.message = 'Permission denied. Check Google Cloud credentials.';
    } else if (error.code === 3) {
      errorResponse.message = 'Invalid argument. Check audio format and encoding.';
    } else if (error.code === 8) {
      errorResponse.message = 'Resource exhausted. STT quota exceeded.';
    } else if (error.message.includes('upload')) {
      errorResponse.message = 'File upload error. Check file format and size.';
    }

    res.status(500).json(errorResponse);
  } finally {
    // No cleanup needed with memory storage
  }
}
