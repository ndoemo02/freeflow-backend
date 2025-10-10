import express from "express";
import multer from "multer";
import fs from "fs";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Initialize clients inside functions to ensure env vars are loaded
let openai, sttClient, ttsClient;

const initClients = () => {
  if (!openai) {
    const OpenAI = require('openai').default;
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    sttClient = new speech.SpeechClient();
    ttsClient = new textToSpeech.TextToSpeechClient();
  }
};

// Test complete flow: STT → GPT → TTS
router.post("/test-flow", upload.single("audio"), async (req, res) => {
  initClients();
  
  const testResults = {
    timestamp: new Date().toISOString(),
    steps: [],
    overall: 'PASS'
  };

  try {
    console.log('🧪 Testing complete flow...');

    // Step 1: STT (Speech-to-Text)
    console.log('1️⃣ Testing STT...');
    try {
      if (!req.file) {
        throw new Error('No audio file provided');
      }

      const file = fs.readFileSync(req.file.path);
      const audioBytes = file.toString("base64");

      const [sttResponse] = await sttClient.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: "WEBM_OPUS",
          languageCode: "pl-PL",
          model: "default",
        },
      });

      const transcription = sttResponse.results.map(r => r.alternatives[0].transcript).join("\n");
      
      testResults.steps.push({
        step: 'STT',
        status: 'PASS',
        message: `Transcription successful: "${transcription}"`,
        data: { transcription, confidence: sttResponse.results[0]?.alternatives[0]?.confidence || 0 }
      });

      // Step 2: GPT Expert
      console.log('2️⃣ Testing GPT Expert...');
      try {
        const systemPrompt = `
        Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
        personalizacji usług gastronomicznych, przewozowych i hotelarskich.
        Doradzasz klientom w oparciu o lokalne dane i potrzeby.
        Zawsze kończ odpowiedź konkretnym rozwiązaniem.
        Odpowiedz krótko i konkretnie.
        `;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcription },
          ],
          max_tokens: 150
        });

        const gptResponse = completion.choices[0].message.content;
        
        testResults.steps.push({
          step: 'GPT',
          status: 'PASS',
          message: `GPT response generated: "${gptResponse}"`,
          data: { response: gptResponse, model: 'gpt-4o-mini' }
        });

        // Step 3: TTS (Text-to-Speech)
        console.log('3️⃣ Testing TTS...');
        try {
          const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: gptResponse },
            voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-E" },
            audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
          });

          if (ttsResponse.audioContent) {
            const audioBase64 = ttsResponse.audioContent.toString('base64');
            
            testResults.steps.push({
              step: 'TTS',
              status: 'PASS',
              message: `TTS audio generated successfully`,
              data: { audioSize: audioBase64.length, format: 'MP3' }
            });

            // Return complete flow result
            res.json({
              ok: true,
              ...testResults,
              finalAudio: audioBase64,
              flow: {
                input: transcription,
                gptResponse: gptResponse,
                audioGenerated: true
              }
            });
          } else {
            throw new Error('No audio content received from TTS');
          }
        } catch (ttsError) {
          testResults.steps.push({
            step: 'TTS',
            status: 'FAIL',
            message: ttsError.message,
            error: ttsError.code
          });
          testResults.overall = 'FAIL';
        }
      } catch (gptError) {
        testResults.steps.push({
          step: 'GPT',
          status: 'FAIL',
          message: gptError.message,
          error: gptError.code
        });
        testResults.overall = 'FAIL';
      }
    } catch (sttError) {
      testResults.steps.push({
        step: 'STT',
        status: 'FAIL',
        message: sttError.message,
        error: sttError.code
      });
      testResults.overall = 'FAIL';
    }

    // Clean up uploaded file
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    if (testResults.overall === 'FAIL') {
      res.status(500).json({
        ok: false,
        ...testResults
      });
    }

  } catch (error) {
    console.error('❌ Flow test error:', error);
    
    testResults.overall = 'FAIL';
    testResults.steps.push({
      step: 'SYSTEM',
      status: 'FAIL',
      message: error.message,
      error: error.code
    });

    res.status(500).json({
      ok: false,
      ...testResults
    });
  }
});

// Test individual components
router.post("/test-stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

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
    
    // Clean up
    fs.unlinkSync(req.file.path);
    
    res.json({
      ok: true,
      transcription,
      confidence: response.results[0]?.alternatives[0]?.confidence || 0
    });
  } catch (error) {
    console.error('❌ STT test error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/test-gpt", async (req, res) => {
  initClients();
  
  try {
    const { text } = req.body;

    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    personalizacji usług gastronomicznych, przewozowych i hotelarskich.
    Doradzasz klientom w oparciu o lokalne dane i potrzeby.
    Zawsze kończ odpowiedź konkretnym rozwiązaniem.
    Odpowiedz krótko i konkretnie.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      max_tokens: 150
    });

    const response = completion.choices[0].message.content;
    
    res.json({
      ok: true,
      response,
      model: 'gpt-4o-mini'
    });
  } catch (error) {
    console.error('❌ GPT test error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/test-tts", async (req, res) => {
  initClients();
  
  try {
    const { text } = req.body;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-E" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    });

    if (response.audioContent) {
      const audioBase64 = response.audioContent.toString('base64');
      
      res.json({
        ok: true,
        audioContent: audioBase64,
        audioSize: audioBase64.length,
        format: 'MP3'
      });
    } else {
      throw new Error('No audio content received');
    }
  } catch (error) {
    console.error('❌ TTS test error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
