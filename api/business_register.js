import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRole = process.env.SERVICE_ROLE
const supabase = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null

export default async function businessRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const body = (req.headers['content-type'] || '').includes('application/json') ? req.body : JSON.parse((await readBody(req)) || '{}')
    const { name, email, phone, city, nip, note } = body || {}
    if (!name || !email) return res.status(400).json({ error: 'Missing required fields: name, email' })

    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    const { error } = await supabase.from('business_leads').insert({ name, email, phone, city, nip, note, created_at: new Date().toISOString() })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}


