// freeflow-backend/api/stt.js
import express from 'express';
import speech from '@google-cloud/speech';

export const sttRouter = express.Router();

sttRouter.post('/stt', async (req, res) => {
  try {
    const { audioContent, mimeType = 'audio/webm' } = req.body || {};
    if (!audioContent) return res.status(400).json({ transcript: '' });

    // WEBM/OPUS → webm opus
    const encoding = mimeType.includes('webm') ? 'WEBM_OPUS' : 'OGG_OPUS'; // prosta heurystyka
    const client = new speech.SpeechClient();

    const audio = { content: audioContent };
    const config = {
      languageCode: 'pl-PL',
      encoding,
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    };

    const [response] = await client.recognize({ audio, config });
    const alt = response.results?.[0]?.alternatives?.[0];
    res.json({ transcript: alt?.transcript || '' });
  } catch (e) {
    console.error('STT error', e);
    res.status(500).json({ transcript: '' });
  }
});
