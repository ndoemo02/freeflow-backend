import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Inicjalizacja klienta OpenAI poza handlerem dla lepszej wydajności
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = 'edge';

/**
 * Endpoint API do generowania mowy z tekstu (Text-to-Speech).
 * Przyjmuje metodę POST z danymi w formacie JSON.
 *
 * @param {NextRequest} req - Obiekt żądania.
 * @body {string} text - Tekst do przetworzenia na mowę.
 * @body {string} [model='tts-1'] - Model do użycia (np. 'tts-1', 'tts-1-hd').
 * @body {string} [voice='alloy'] - Głos do użycia (np. 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer').
 * @returns {Promise<NextResponse>} Odpowiedź z plikiem audio w formacie MP3 lub błędem.
 */
export async function POST(req: NextRequest) {
  try {
    const { text, model = 'tts-1', voice = 'alloy' } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const speechResponse = await openai.audio.speech.create({
      model: model,
      voice: voice,
      input: text,
      response_format: 'mp3',
    });

    // Sprawdzenie, czy odpowiedź z OpenAI jest poprawna
    if (!speechResponse.ok) {
      const errorBody = await speechResponse.text();
      console.error('OpenAI API Error:', errorBody);
      return NextResponse.json({ error: 'Failed to generate speech from OpenAI', details: errorBody }, { status: speechResponse.status });
    }

    // Pobranie danych jako ArrayBuffer
    const audioBuffer = await speechResponse.arrayBuffer();

    // Zwrócenie odpowiedzi z poprawnymi nagłówkami dla pliku audio
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="speech.mp3"',
      },
    });

  } catch (error) {
    console.error('TTS Endpoint Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal Server Error', details: errorMessage }, { status: 500 });
  }
}