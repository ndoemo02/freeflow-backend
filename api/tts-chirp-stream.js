import { applyCORS } from './_cors.js';
import WebSocket from 'ws';
import { Buffer } from 'buffer';
import crypto from 'crypto';

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

    // Użyj Google Cloud credentials do generowania access token
    let credentials;
    if (process.env.GOOGLE_VOICEORDER_KEY_B64) {
      console.log("✅ Using GOOGLE_VOICEORDER_KEY_B64 (Vercel)");
      const decoded = Buffer.from(process.env.GOOGLE_VOICEORDER_KEY_B64, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS (local)");
      const fs = await import('fs');
      const path = await import('path');
      const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (fs.existsSync(credentialsPath)) {
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      } else {
        throw new Error(`Credentials file not found: ${credentialsPath}`);
      }
    } else {
      throw new Error('No Google credentials found');
    }

    // Generuj access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createJWT(credentials)
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      throw new Error('Failed to get access token');
    }

    const ws = new WebSocket(
      'wss://texttospeech.googleapis.com/v1beta1/text:streamingSynthesize',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
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

// Funkcja do tworzenia JWT dla Google OAuth
function createJWT(credentials) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${encodedHeader}.${encodedPayload}`);
  const signature = sign.sign(credentials.private_key, 'base64url');
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
