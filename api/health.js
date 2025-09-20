
import { applyCors } from '../lib/cors.js';


// /api/health.js
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  return res.status(200).json({
    status: 'ok',
    service: 'freeflow-backend',
    ts: new Date().toISOString()
  });
}
