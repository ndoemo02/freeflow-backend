// api/brain/context.js
import { getContext, saveContext, clearContext } from './memory.js';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const context = getContext();
      return res.status(200).json({
        ok: true,
        lastRestaurant: context.lastRestaurant,
        lastIntent: context.lastIntent,
        lastUpdated: context.lastUpdated,
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      const { intent, restaurant } = req.body;
      if (intent === 'clear') {
        clearContext();
        return res.status(200).json({ ok: true, message: 'Context cleared' });
      } else {
        saveContext(intent, restaurant);
        return res.status(200).json({ ok: true, message: 'Context updated' });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Context API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
