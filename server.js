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

function createSpeechClient() {
  const inlineCredentials = process.env.GOOGLE_CREDENTIALS_JSON;
  if (inlineCredentials) {
    try {
      const parsed = JSON.parse(inlineCredentials);
      return new SpeechClient({ credentials: parsed });
    } catch (error) {
      console.error("Invalid GOOGLE_CREDENTIALS_JSON:", error.message);
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new SpeechClient();
  }

  return null;
}

const speechClient = createSpeechClient();
const sttApiKey = process.env.GOOGLE_STT_API_KEY || process.env.GOOGLE_API_KEY || "";
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
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

async function transcribeWithApiKey(audioContentBase64, config) {
  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${sttApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config,
        audio: { content: audioContentBase64 }
      })
    }
  );

  const payload = await response.json();
  if (!response.ok || payload.error) {
    const detail = payload?.error?.message || `Speech API HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required." });
    }

    if (!speechClient && !sttApiKey) {
      return res.status(500).json({
        error: "Google STT is not configured.",
        detail:
          "Set GOOGLE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS) or GOOGLE_STT_API_KEY."
      });
    }

    const languageCode = req.body.languageCode || "ko-KR";
    const encoding = inferEncoding(req.file.mimetype);

    const config = {
      encoding,
      languageCode,
      enableAutomaticPunctuation: true,
      model: "latest_long"
    };

    const audioContentBase64 = req.file.buffer.toString("base64");

    const response = speechClient
      ? (await speechClient.recognize({ audio: { content: audioContentBase64 }, config }))[0]
      : await transcribeWithApiKey(audioContentBase64, config);

    const transcript = (response.results || [])
      .map((r) => r.alternatives?.[0]?.transcript || "")
      .join(" ")
      .trim();

    return res.json({
      transcript,
      confidence: response.results?.[0]?.alternatives?.[0]?.confidence ?? null
    });
  } catch (error) {
    console.error("Transcribe error:", error);
    return res.status(500).json({
      error: "Failed to transcribe audio.",
      detail: error.message
    });
  }
});

app.post("/api/meeting-notes", async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        error: "Gemini is not configured.",
        detail: "Set GEMINI_API_KEY or GOOGLE_API_KEY."
      });
    }

    const { transcript } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "transcript is required." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
You are a meeting assistant.
Analyze the transcript below and return JSON only.
Format:
{
  "summary": "3-5 sentence summary",
  "keyPoints": ["Point 1", "Point 2"],
  "actionItems": [{"owner":"owner", "task":"task", "due":"date or TBD"}],
  "risks": ["risk 1"]
}

Transcript:
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
      error: "Failed to generate meeting notes.",
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
