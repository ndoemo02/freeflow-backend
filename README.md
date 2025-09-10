# FreeFlow Backend

Backend dla aplikacji FreeFlow - serwer obsługujący transkrypcję audio i integrację z AI.

## Technologie
- Node.js
- Express/Vercel Functions
- Supabase
- OpenAI API

## Instalacja

1. Sklonuj repozytorium:
```bash
git clone https://github.com/ndoemo02/freeflow-backend.git
cd freeflow-backend
```

2. Zainstaluj zależności:
```bash
npm install
```

3. Skonfiguruj zmienne środowiskowe:
Utwórz plik `.env` i dodaj:
```
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
```

4. Uruchom serwer:
```bash
npm start
```

## API Endpoints
- `/api/transcribe` - transkrypcja plików audio
- `/api/health` - sprawdzenie stanu serwera

## Struktura
- `/api` - funkcje API
- `/lib` - biblioteki pomocnicze
- `/public` - pliki statyczne
- `asr.js` - automatyczne rozpoznawanie mowy
- `search.js` - funkcje wyszukiwania

## Wdrożenie
Aplikacja jest skonfigurowana do wdrożenia na Vercel.

## Licencja
MIT
