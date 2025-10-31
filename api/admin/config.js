// api/admin/config.js
import fs from 'fs';
import path from 'path';

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

const ENV_FILE = path.resolve(process.cwd(), '.env.vercel');

function readBoolEnv(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getGlobalConfig() {
  if (!globalThis.__amber_control_config) {
    globalThis.__amber_control_config = {
      tts_mode: process.env.TTS_MODE || 'wavenet',
      tts_streaming: readBoolEnv('TTS_STREAMING', false),
      cache_enabled: readBoolEnv('CACHE_ENABLED', true),
      stylization: process.env.TTS_STYLIZATION || 'gpt-4o',
      env: process.env.NODE_ENV || 'development'
    };
  }
  return globalThis.__amber_control_config;
}

async function persistEnvPatch(patch) {
  try {
    let envContent = '';
    if (fs.existsSync(ENV_FILE)) envContent = await fs.promises.readFile(ENV_FILE, 'utf8');
    const map = new Map(envContent.split('\n').map(l => [l.split('=')[0], l]));
    for (const [k, v] of Object.entries(patch)) {
      map.set(k, `${k}=${v}`);
      process.env[k] = String(v); // update in-memory
    }
    const next = Array.from(map.values()).filter(Boolean).join('\n');
    await fs.promises.writeFile(ENV_FILE, next, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

  if (req.method === 'GET') {
    const cfg = getGlobalConfig();
    return res.status(200).json({ ok: true, ...cfg });
  }
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const cfg = getGlobalConfig();
      const allowedKeys = ['tts_mode','tts_streaming','cache_enabled','stylization'];
      const update = {};
      for (const k of allowedKeys) if (k in body) cfg[k] = body[k];

      // attempt to persist to .env.vercel
      // map to env names
      if (fs.existsSync(ENV_FILE)) {
        if ('tts_mode' in body) update['TTS_MODE'] = body.tts_mode;
        if ('tts_streaming' in body) update['TTS_STREAMING'] = body.tts_streaming ? 'true' : 'false';
        if ('cache_enabled' in body) update['CACHE_ENABLED'] = body.cache_enabled ? 'true' : 'false';
        if ('stylization' in body) update['TTS_STYLIZATION'] = body.stylization;
        await persistEnvPatch(update);
      }

      return res.status(200).json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}


