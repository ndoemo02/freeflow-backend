// api/brain/amber.js
import { setMemory } from './memory.js';

export default async function handler(req, res) {
  try {
    const { text, lat, lng } = req.body;

    // 🧠 Amber zaczyna myśleć
    await setMemory({ status: 'thinking', userMessage: text });

    // ... Twoja istniejąca logika Amber (LLM / Supabase / Nearby)
    const reply = await generateAmberResponse(text, lat, lng);
    const intent = reply.intent || 'general';
    const context = reply.context || {};

    // 💬 Gdy generuje odpowiedź
    await setMemory({
      status: 'speaking',
      lastIntent: intent,
      context,
      lastMessage: reply.text || reply,
    });

    // Odpowiedź do frontu
    res.status(200).json({ ok: true, ...reply });

    // ⏳ Po chwili spoczynku
    setTimeout(() => setMemory({ status: 'idle' }), 2000);
  } catch (err) {
    console.error('❌ Amber Brain error:', err);
    await setMemory({ status: 'confused' });
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function generateAmberResponse(text, lat, lng) {
  // 🧩 Placeholder — użyj istniejącej logiki Amber, np. nearby + TTS
  return {
    text: `Oto restauracje w pobliżu dla: ${text}`,
    intent: 'find_restaurant',
    context: { lat, lng },
  };
}