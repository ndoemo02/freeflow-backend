// api/admin/prompt.js
import fs from 'fs';
import path from 'path';

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

function getPromptPath() {
  const p = process.env.ADMIN_PROMPT_PATH || './prompts/tts-style.txt';
  return path.resolve(process.cwd(), p);
}

export default async function handler(req, res) {
  const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

  const filePath = getPromptPath();

  if (req.method === 'GET') {
    try {
      let content = '';
      try {
        content = await fs.promises.readFile(filePath, 'utf8');
      } catch (e) {
        content = '';
      }
      return res.status(200).json({ ok: true, path: filePath, content });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const content = String(body.content || '');
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf8');
      // cache in memory for quick access
      globalThis.__amber_tts_prompt = content;
      return res.status(200).json({ ok: true, saved: true, path: filePath, size: content.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}


