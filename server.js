const express = require("express");
const multer = require("multer");
const path = require("path");
const dotenv = require("dotenv");
const { SpeechClient } = require("@google-cloud/speech");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const speechClient = new SpeechClient();
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

function inferEncoding(mimetype) {
  if (!mimetype) return "ENCODING_UNSPECIFIED";
  if (mimetype.includes("webm")) return "WEBM_OPUS";
  if (mimetype.includes("ogg")) return "OGG_OPUS";
  if (mimetype.includes("wav")) return "LINEAR16";
  if (mimetype.includes("flac")) return "FLAC";
  if (mimetype.includes("mp3") || mimetype.includes("mpeg")) return "MP3";
  return "ENCODING_UNSPECIFIED";
}

function safeJsonParse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    const cleaned = trimmed
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (_err2) {
      return null;
    }
  }
}

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio 파일이 필요합니다." });
    }

    const languageCode = req.body.languageCode || "ko-KR";
    const encoding = inferEncoding(req.file.mimetype);

    const request = {
      audio: { content: req.file.buffer.toString("base64") },
      config: {
        encoding,
        languageCode,
        enableAutomaticPunctuation: true,
        model: "latest_long"
      }
    };

    const [response] = await speechClient.recognize(request);
    const transcript = (response.results || [])
      .map((r) => r.alternatives?.[0]?.transcript || "")
      .join(" ")
      .trim();

    return res.json({
      transcript,
      confidence:
        response.results?.[0]?.alternatives?.[0]?.confidence ?? null
    });
  } catch (error) {
    console.error("Transcribe error:", error);
    return res.status(500).json({
      error: "음성 전사 중 오류가 발생했습니다.",
      detail: error.message
    });
  }
});

app.post("/api/meeting-notes", async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        error: "GEMINI_API_KEY가 설정되지 않았습니다."
      });
    }

    const { transcript } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "transcript가 필요합니다." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
너는 회의 기록 비서다.
아래 회의 전사 텍스트를 분석해 JSON만 출력해라.
형식:
{
  "summary": "3~5문장 요약",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2"],
  "actionItems": [{"owner":"담당자", "task":"할 일", "due":"기한(없으면 미정)"}],
  "risks": ["리스크 1"]
}

회의 전사:
${transcript}
`.trim();

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = safeJsonParse(text);

    if (parsed) {
      return res.json(parsed);
    }

    return res.json({
      summary: text,
      keyPoints: [],
      actionItems: [],
      risks: []
    });
  } catch (error) {
    console.error("Meeting notes error:", error);
    return res.status(500).json({
      error: "회의 요약 생성 중 오류가 발생했습니다.",
      detail: error.message
    });
  }
});

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}
