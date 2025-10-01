import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import ttsHandler from './api/tts.js'

// HANDLERY API (dodasz swoje później)
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// TTS endpoint using Google Cloud TTS
app.post('/api/tts', ttsHandler);

const PORT = process.env.PORT || 3003
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => {
	console.log(`Backend API on http://${HOST}:${PORT}`)
})
