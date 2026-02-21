# Meeting STT WebApp

Web app that transcribes meeting audio with Google Speech-to-Text and generates notes with Gemini.

## Features
- Record microphone audio in browser and transcribe
- Upload audio files and transcribe
- Generate meeting notes as JSON: `summary`, `keyPoints`, `actionItems`, `risks`

## Stack
- Backend: Node.js, Express, Multer
- STT: Google Cloud Speech-to-Text
- Notes: Gemini API (`@google/generative-ai`)
- Frontend: HTML, CSS, Vanilla JS

## Install
```bash
npm install
```

## Environment
Create `.env` using `.env.example`:

```env
PORT=3000
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GOOGLE_STT_API_KEY=YOUR_GOOGLE_STT_API_KEY
GOOGLE_API_KEY=
GOOGLE_CREDENTIALS_JSON=
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\google-service-account.json
```

Notes:
- STT auth supports either service-account credentials (`GOOGLE_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`) or API key (`GOOGLE_STT_API_KEY`).
- `GOOGLE_API_KEY` can be used as a shared fallback key for both Gemini and STT.
- If Google Speech API is unavailable, transcription automatically falls back to Gemini audio transcription when `GEMINI_API_KEY` is configured.

## Google Speech Setup
1. Create or select a Google Cloud project
2. Enable billing
3. Enable Speech-to-Text API
4. Create a service account and download JSON key
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to that JSON path

## Run
```bash
npm run dev
```
or
```bash
npm start
```

Open `http://localhost:3000`.

## API
- `POST /api/transcribe` (`multipart/form-data`)
- `POST /api/meeting-notes` (`application/json`)

## Security
- Never hardcode Gemini key or Google service-account key in source code.
