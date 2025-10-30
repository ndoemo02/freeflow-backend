// utils/keepAlive.js — utrzymuje funkcję Vercel „ciepłą”
// Działa tylko w production; brak zależności od OpenAI/Supabase

const isProd = process.env.NODE_ENV === "production";

(async () => {
  if (!isProd) return;

  // Preferuj node-fetch (zgodnie z wymaganiem), ale miej fallback na global fetch (Node 18+)
  let fetchFn = (typeof fetch === 'function') ? fetch : null;
  try {
    const mod = await import('node-fetch');
    fetchFn = mod.default;
  } catch (e) {
    // fallback: global fetch
  }

  if (!fetchFn) return; // środowisko bez fetch — nie uruchamiaj pętli

  const baseFromEnv = process.env.VERCEL_URL || "https://freeflow-backend.vercel.app";
  const base = baseFromEnv.startsWith("http") ? baseFromEnv : `https://${baseFromEnv}`;
  const url = `${base}/api/ping`;

  const ping = async () => {
    const now = new Date().toISOString();
    try {
      const res = await fetchFn(url, { method: 'GET' });
      if (res.ok) {
        console.log(`[KEEPALIVE] Ping sent → OK (${now})`);
      } else {
        console.log(`[KEEPALIVE] Error: ${res.status} ${res.statusText} (${now})`);
      }
    } catch (err) {
      console.log(`[KEEPALIVE] Error: ${err?.message || err} (${now})`);
    }
  };

  // Pierwszy ping po krótkim opóźnieniu, kolejne co 120s
  setTimeout(ping, 2000);
  setInterval(ping, 120 * 1000);
})();


