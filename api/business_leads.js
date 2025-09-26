import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRole = process.env.SERVICE_ROLE
const supabase = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null

export default async function businessLeads(req, res) {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200)
    const from = req.query.from || null
    const to = req.query.to || null
    let q = supabase.from('business_leads').select('id, created_at, name, email, phone, city').order('created_at', { ascending: false }).limit(limit)
    if (from) q = q.gte('created_at', from)
    if (to) q = q.lte('created_at', to)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ results: data || [] })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}


