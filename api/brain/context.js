// api/brain/context.js
import { getMemory, setMemory } from './memory.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const memory = await getMemory();
      return res.status(200).json({
        ok: true,
        status: memory.status || 'idle',
        context: memory.context || null,
        lastIntent: memory.lastIntent || null,
        lastMessage: memory.lastMessage || null,
        userMessage: memory.userMessage || null,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'POST') {
      const { status, context, lastIntent, lastMessage, userMessage } = req.body;
      await setMemory({ status, context, lastIntent, lastMessage, userMessage });
      return res.status(200).json({ ok: true, message: 'Amber context updated.' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('❌ Context API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
