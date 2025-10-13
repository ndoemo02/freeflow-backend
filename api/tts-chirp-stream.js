import { applyCORS } from './_cors.js';
import WebSocket from 'ws';
import { Buffer } from 'buffer';
import { getVertexAccessToken } from '../utils/googleAuth.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(JSON.parse(data || '{}')));
      req.on('error', reject);
    });

    const { text, languageCode = 'pl-PL' } = body;
    if (!text) return res.status(400).json({ error: 'Missing text field' });

    console.log('🔴 Live Stream TTS request:', { text: text.substring(0, 50) + '...', languageCode });

    // Użyj dedykowanego modułu do autoryzacji
    const token = await getVertexAccessToken();

    const ws = new WebSocket(
      'wss://texttospeech.googleapis.com/v1beta1/text:streamingSynthesize',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
      'X-TTS-Mode': 'live-streaming'
    });

    ws.on('open', () => {
      console.log('🔴 WebSocket connected for streaming TTS');
      ws.send(
        JSON.stringify({
          streamingConfig: {
            voice: {
              languageCode,
              name: 'pl-PL-Studio-B',
              model: 'chirp-3-hd',
            },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: 1.1,
              pitch: 0.2,
              volumeGainDb: 2.0,
            },
          },
          input: { text },
        })
      );
    });

    ws.on('message', (message) => {
      const msg = JSON.parse(message.toString());
      if (msg.audioContent) {
        const chunk = Buffer.from(msg.audioContent, 'base64');
        res.write(chunk);
      }
    });

    ws.on('close', () => {
      console.log('✅ Live Stream TTS completed');
      res.end();
    });

    ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err);
      res.end();
    });

  } catch (err) {
    console.error('❌ Streaming Chirp error:', err);
    res.status(500).json({ error: err.message });
  }
}

