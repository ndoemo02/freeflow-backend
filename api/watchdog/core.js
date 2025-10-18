import { supabase } from "../_supabase.js";
import { playTTS } from "../tts.js"; // Twój handler TTS

async function logEvent(level, message) {
  console.log(`[${level.toUpperCase()}] ${message}`);
  await supabase.from("system_logs").insert([{ level, message }]);
}

async function speakAlert(message) {
  try {
    await playTTS(`Szefie, ${message}`, { voice: "pl-PL-Wavenet-E" });
  } catch (e) {
    console.error("TTS Alert failed:", e);
  }
}

export async function runWatchdog() {
  try {
    const { data, error } = await supabase.from("restaurants").select("id").limit(1);
    if (error) throw error;
    await logEvent("info", "Supabase heartbeat OK");
  } catch (err) {
    await logEvent("critical", `Supabase connection failed: ${err.message}`);
    await speakAlert("mamy problem z warstwą Supabase.");
    throw err;
  }

  try {
    const apiTest = await fetch("https://freeflow-backend.vercel.app/api/health");
    if (!apiTest.ok) throw new Error(apiTest.statusText);
    await logEvent("info", "API layer OK");
  } catch (err) {
    await logEvent("critical", `API connection failed: ${err.message}`);
    await speakAlert("mamy problem z warstwą API.");
  }
}

