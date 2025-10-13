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
      credentials = { keyFilename: './service-account.json' };
    }

    ttsClient = new TextToSpeechClient({ credentials });
  } catch (err) {
    console.error("❌ TTS init error:", err);
    throw new Error(`Failed to initialize TTS client: ${err.message}`);
  }

  return ttsClient;
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return; // 👈 ważne: obsługuje preflight

  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Standard-A' } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text field" });

    const client = initializeTtsClient();

    const request = {
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    };

    console.log("🎤 Generating voice for:", text);
    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) throw new Error("Empty audio content from Google TTS");

    const audioBuffer = Buffer.from(response.audioContent, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.status(200).end(audioBuffer);

  } catch (error) {
    console.error("❌ TTS handler error:", error.message);
    if (typeof error.stack === 'string') console.error(error.stack);

    res.status(500).json({
      ok: false,
      error: 'TTS_ERROR',
      message: error.message,
      hint: 'Check Google credentials or API quota'
    });
  }
}