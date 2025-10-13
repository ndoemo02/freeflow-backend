// /api/realtime-freeflow.js  (Vercel/Next API Route lub Express handler)

export const config = {
  runtime: 'edge',
}

export default async function handler(req) {
  try {
    console.log('🔴 OpenAI Realtime session request (Edge Runtime)');
    
    // Sprawdź czy mamy klucz API
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY not found');
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log('✅ OpenAI API key found, creating session...');

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // 🟢 tańsza i szybka wersja — idealna do FreeFlow
        model: "gpt-4o-mini-realtime-preview",
        // głos — możesz zmienić (np. alloy, verse, aria… w zależności od dostępności)
        voice: "alloy",
        // Realtime modalities
        modalities: ["audio", "text"],
        // format wejściowego audio z mikrofonu
        input_audio_format: "pcm16",
        // format wyjściowego audio (co odtwarza Amber)
        output_audio_format: "pcm16",
        // (fajny bajer) delikatnie wolniej i niżej, kobieco
        instructions: "You are Amber: a witty, helpful, slightly ironic female assistant (FreeFlow: Voice to order) speaking Polish naturally. Be concise, proactive, and friendly.",
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error('❌ OpenAI session error:', r.status, t);
      return new Response(JSON.stringify({ error: `OpenAI session error: ${r.status} ${t}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await r.json();
    console.log('✅ OpenAI session created:', { 
      hasClientSecret: !!data.client_secret?.value,
      expiresAt: data.expires_at 
    });
    
    // Klucz efemeryczny dla frontu:
    if (!data.client_secret?.value) {
      console.error('❌ No client_secret in response:', data);
      return new Response(JSON.stringify({ error: 'No client_secret in OpenAI response' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      client_secret: data.client_secret.value, 
      expires_at: data.expires_at 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error("realtime session error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}