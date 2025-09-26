// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import geminiStream from "./api/gemini-stream.js";
import placesHandler from './api/places.js';
import ttsHandler from './api/tts.js';
import businessRegister from './api/business_register.js';
import businessLeads from './api/business_leads.js';
import restaurantsHandler from './api/restaurants.js';
import menuHandler from './api/menu.js';
import { sttRouter } from './api/stt.js';
import { ordersRouter } from './api/orders.js';

// (opcjonalnie) inne importy...
import geminiRoute from './api/gemini.js';

const app = express();                         // <-- NAJPIERW tworzysz app
const PORT = process.env.PORT || 3003;         // możesz zmienić port tutaj lub w .env
const HOST = process.env.HOST || '0.0.0.0';    // nasłuchuj na wszystkich interfejsach

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Zwiększ limit dla audio

// Rejestracja ROUTÓW dopiero po utworzeniu app
app.use('/api/gemini', geminiRoute);
app.get('/api/gemini-stream', geminiStream);
app.use('/api', sttRouter);
app.use('/api', ordersRouter);
app.all('/api/places', placesHandler);
app.all('/api/restaurants', restaurantsHandler);
app.all('/api/menu', menuHandler);
app.post('/api/tts', ttsHandler);
app.post('/api/business/register', businessRegister);
app.get('/api/business/leads', businessLeads);

// Proste testy
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/env-test', (_req, res) => {
  res.json({
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ? 'OK' : 'MISSING',
    OPENAI_API_KEY:      process.env.OPENAI_API_KEY      ? 'OK' : 'MISSING',
    GEMINI_API_KEY:      process.env.GEMINI_API_KEY      ? 'OK' : 'MISSING',
    NODE_ENV:            process.env.NODE_ENV || 'unknown',
    TIMESTAMP:           new Date().toISOString()
  });
});

// Start
app.listen(PORT, HOST, () => {
  console.log(`Backend server running on http://${HOST}:${PORT}`);
});
