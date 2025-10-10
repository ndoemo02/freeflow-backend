import express from "express";
import dotenv from "dotenv";

// Load environment variables first
dotenv.config();

import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import testFlowRouter from "./api/test-flow.js";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize clients inside functions to ensure env vars are loaded
let openai, sttClient, ttsClient;

const initClients = () => {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    sttClient = new speech.SpeechClient();
    ttsClient = new textToSpeech.TextToSpeechClient();
  }
};

const upload = multer({ dest: "uploads/" });

// Use test flow router
app.use("/api", testFlowRouter);

// === [1] SPEECH → TEXT ===
app.post("/stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    const file = fs.readFileSync(req.file.path);
    const audioBytes = file.toString("base64");

    const [response] = await sttClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "pl-PL",
        model: "default",
      },
    });

    const transcription = response.results.map(r => r.alternatives[0].transcript).join("\n");
    console.log("🎙️ Transkrypcja:", transcription);
    res.json({ text: transcription });
  } catch (err) {
    console.error("❌ Błąd STT:", err);
    res.status(500).json({ error: "Błąd transkrypcji głosu" });
  }
});

// === [2] GPT EXPERT ===
app.post("/expert", async (req, res) => {
  initClients();
  
  try {
    const { query, context } = req.body;

    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    personalizacji usług gastronomicznych, przewozowych i hotelarskich.
    Doradzasz klientom w oparciu o lokalne dane i potrzeby.
    Zawsze kończ odpowiedź konkretnym rozwiązaniem.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
    });

    const response = completion.choices[0].message.content;
    console.log("🧠 GPT:", response);
    res.json({ response });
  } catch (err) {
    console.error("❌ Błąd eksperta:", err);
    res.status(500).json({ error: "Błąd przetwarzania GPT" });
  }
});

// === [3] TEXT → SPEECH ===
app.post("/tts", async (req, res) => {
  initClients();
  
  try {
    const { text } = req.body;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-E" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    });

    const outputFile = `tts_${Date.now()}.mp3`;
    fs.writeFileSync(outputFile, response.audioContent, "binary");
    console.log("🔊 Wygenerowano TTS:", outputFile);
    res.download(outputFile, () => fs.unlinkSync(outputFile));
  } catch (err) {
    console.error("❌ Błąd TTS:", err);
    res.status(500).json({ error: "Błąd generowania głosu" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FreeFlow Voice Expert działa na porcie ${PORT}`));