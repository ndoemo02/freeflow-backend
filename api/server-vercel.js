// --- FreeFlow Serverless Adapter for Vercel ---
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';

// --- App setup ---
const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('tiny'));

// --- Env sanity ---
console.log('🚀 Booting FreeFlow Serverless...');
console.log('🔑 SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅' : '❌');

// --- Supabase client ---
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Example health route ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Amber is alive 🧠💬' });
});

// --- Optional: route to check environment health ---
app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV
  });
});

// --- Export handler for Vercel ---
export default app;


