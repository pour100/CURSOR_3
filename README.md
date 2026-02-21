# Meeting STT WebApp

Google Speech-to-Text로 음성을 전사하고, Gemini로 회의 요약을 생성하는 웹앱입니다.

## 기능
- 브라우저 마이크 녹음 후 전사
- 오디오 파일 업로드 후 전사
- 전사 텍스트 기반 회의 요약(JSON: summary, keyPoints, actionItems, risks)

## 기술 스택
- Backend: Node.js, Express, Multer
- STT: Google Cloud Speech-to-Text
- LLM 요약: Gemini API (`@google/generative-ai`)
- Frontend: HTML/CSS/Vanilla JS

## 1) 설치
```bash
npm install
```

## 2) 환경변수 설정
`.env.example`를 참고해 `.env` 파일 생성:

```env
PORT=3000
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\google-service-account.json
```

## 3) Google Speech-to-Text 준비
1. Google Cloud 프로젝트 생성/선택
2. Billing 활성화
3. Speech-to-Text API 활성화
4. 서비스 계정 생성 후 JSON 키 발급
5. `GOOGLE_APPLICATION_CREDENTIALS`에 JSON 파일 경로 지정

## 4) 실행
```bash
npm run dev
```
또는
```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속

## API 요약
- `POST /api/transcribe` (`multipart/form-data`)
  - `audio`: 오디오 파일
  - `languageCode`: 예) `ko-KR`
- `POST /api/meeting-notes` (`application/json`)
  - `transcript`: 전사 텍스트

## 주의
- Gemini 키와 Google 서비스계정 키는 절대 코드에 하드코딩하지 마세요.
- STT 정확도는 음질/언어코드/코덱에 따라 달라집니다.
