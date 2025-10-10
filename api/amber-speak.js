import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import fs from 'fs';

const client = new TextToSpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    console.log('🗣️ Amber mówi:', text);

    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: { languageCode: 'pl-PL', name: 'pl-PL-Wavenet-D' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0.0 },
    });

    const audioBase64 = response.audioContent.toString('base64');
    res.status(200).json({ ok: true, audio: audioBase64 });
  } catch (err) {
    console.error('❌ Amber error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
