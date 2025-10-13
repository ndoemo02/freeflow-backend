// api/brain/context.js
import { getMemory, setMemory } from './memory.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const memory = await getMemory();
      return res.status(200).json({
        ok: true,
        context: memory.context,
        lastIntent: memory.lastIntent,
        status: memory.status || 'idle',
        lastMessage: memory.lastMessage || null,
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      const { status, context, lastIntent, lastMessage } = req.body;
      await setMemory({ status, context, lastIntent, lastMessage });
      return res.status(200).json({ ok: true, message: 'Context updated' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Context API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
