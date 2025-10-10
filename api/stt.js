import { SpeechClient } from '@google-cloud/speech';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

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
      console.log('⚠️ STT: Trying default Google Cloud credentials...');
      speechClient = new SpeechClient();
    }
  } catch (error) {
    console.error('❌ STT: Failed to initialize client:', error);
    throw error;
  }

  return speechClient;
}

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
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

// Clean up uploaded files
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ Cleaned up file:', filePath);
    }
  } catch (error) {
    console.error('❌ Error cleaning up file:', error);
  }
}

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

    // Read audio file
    const audioBuffer = fs.readFileSync(uploadedFile.path);
    const audioBytes = audioBuffer.toString('base64');

    // Initialize Speech client
    const client = initializeSpeechClient();

    // Determine audio encoding based on file type
    let encoding = 'WEBM_OPUS';
    if (uploadedFile.mimetype.includes('wav')) {
      encoding = 'LINEAR16';
    } else if (uploadedFile.mimetype.includes('mp3')) {
      encoding = 'MP3';
    } else if (uploadedFile.mimetype.includes('flac')) {
      encoding = 'FLAC';
    }

    console.log('🎵 Audio encoding:', encoding);

    // Configure recognition request
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding,
        languageCode: 'pl-PL',
        model: 'default',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: false,
        sampleRateHertz: 16000,
        alternativeLanguageCodes: ['en-US'],
      },
    };

    console.log('🔄 Sending to Google Cloud Speech-to-Text...');
    
    // Perform speech recognition
    const [response] = await client.recognize(request);
    
    if (!response.results || response.results.length === 0) {
      return res.status(200).json({
        ok: true,
        text: '',
        confidence: 0,
        message: 'No speech detected in audio'
      });
    }

    // Extract transcription and confidence
    const result = response.results[0];
    const transcription = result.alternatives[0].transcript;
    const confidence = result.alternatives[0].confidence || 0;

    console.log('✅ STT completed:', {
      text: transcription.substring(0, 100) + '...',
      confidence: confidence
    });

    res.status(200).json({
      ok: true,
      text: transcription,
      confidence: confidence,
      language: 'pl-PL',
      encoding: encoding,
      duration: uploadedFile.size / 16000 // Rough estimate
    });

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
    // Clean up uploaded file
    if (uploadedFile && uploadedFile.path) {
      cleanupFile(uploadedFile.path);
    }
  }
}
