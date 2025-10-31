// api/admin/performance-top-intents.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const daysBack = parseInt(req.query.days || '7', 10);
    const sinceIso = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();

    const { data, error } = await supabase
      .from('amber_intents')
      .select('intent,duration_ms,durationMs,created_at')
      .gte('created_at', sinceIso);
    if (error) throw error;

    const buckets = new Map();
    (data || []).forEach(r => {
      const intent = r.intent || 'unknown';
      const dur = typeof r.duration_ms === 'number' ? r.duration_ms : r.durationMs;
      if (typeof dur !== 'number') return;
      const b = buckets.get(intent) || { sum: 0, count: 0 };
      b.sum += dur; b.count += 1; buckets.set(intent, b);
    });

    const rows = Array.from(buckets.entries()).map(([intent, { sum, count }]) => ({ intent, avgMs: Math.round(sum / count), count }));
    rows.sort((a,b)=> b.avgMs - a.avgMs);
    const top = rows.slice(0, parseInt(req.query.limit || '5', 10));

    return res.status(200).json({ ok: true, data: top, days: daysBack, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}


