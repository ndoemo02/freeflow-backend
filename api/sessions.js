import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, sessionId, userId, message, eventType, data } = req.body;

    switch (action) {
      case 'create_session':
        const { data: session, error: sessionError } = await supabase
          .from('sessions')
          .insert([{
            id: sessionId,
            user_id: userId,
            created_at: new Date().toISOString(),
            status: 'active'
          }])
          .select();
        
        if (sessionError) throw sessionError;
        return res.status(200).json({ ok: true, session });

      case 'save_message':
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            content: message.content,
            role: message.role, // 'user' or 'assistant'
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (messageError) throw messageError;
        return res.status(200).json({ ok: true, message: messageData });

      case 'log_event':
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            event_type: eventType,
            data: data,
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (eventError) throw eventError;
        return res.status(200).json({ ok: true, event: eventData });

      case 'get_session_history':
        const { data: history, error: historyError } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });
        
        if (historyError) throw historyError;
        return res.status(200).json({ ok: true, history });

      default:
        return res.status(400).json({ ok: false, error: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Sessions API error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
