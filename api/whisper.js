// api/whisper.js
// Vercel / Node runtime. Przyjmuje audio/webm z przeglądarki i przepuszcza do OpenAI Whisper.
// Env: OPENAI_API_KEY (ustaw w Vercel → Settings → Environment Variables)
import { applyCors } from './cors.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    // wczytaj surowe bajty audio
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    // zbuduj multipart do OpenAI
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'speech.webm');
    form.append('model', 'whisper-1'); // możesz też użyć: 'gpt-4o-transcribe'

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) return res.status(r.status).json(data);
    return res.json({ text: data.text || '' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
