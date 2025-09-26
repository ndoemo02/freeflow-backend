import textToSpeech from '@google-cloud/text-to-speech';

export default async function ttsHandler(req, res) {
  try {
    const { text, lang = 'pl-PL', voiceName = 'pl-PL-Wavenet-D' } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const client = new textToSpeech.TextToSpeechClient();
    const [resp] = await client.synthesizeSpeech({
      input: { text },
      voice: { languageCode: lang, name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    });

    const audioContent = resp.audioContent?.toString('base64');
    if (!audioContent) return res.status(500).json({ error: 'No audio' });
    res.json({ audioContent });
  } catch (e) {
    console.error('TTS error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}