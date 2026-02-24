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
const geminiTranscribeModelCandidates = (
  process.env.GEMINI_TRANSCRIBE_MODELS || "gemini-2.0-flash,gemini-1.5-pro"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const geminiModelCandidates = (
  process.env.GEMINI_MODELS ||
  "gemini-2.0-flash,gemini-1.5-flash,gemini-1.5-pro"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const geminiTranslateModelCandidates = (
  process.env.GEMINI_TRANSLATE_MODELS ||
  "gemini-2.0-flash,gemini-1.5-flash,gemini-1.5-pro"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

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

function normalizeMimeType(mimetype, encoding) {
  if (mimetype && mimetype !== "audio/mp3") return mimetype;
  if (encoding === "MP3") return "audio/mpeg";
  if (encoding === "LINEAR16") return "audio/wav";
  if (encoding === "WEBM_OPUS") return "audio/webm";
  if (encoding === "OGG_OPUS") return "audio/ogg";
  return "audio/webm";
}

function toTranslateLanguageCode(languageCode = "en-US") {
  if (languageCode.startsWith("ko")) return "ko";
  if (languageCode.startsWith("ja")) return "ja";
  if (languageCode.startsWith("zh")) return "zh-CN";
  if (languageCode.startsWith("es")) return "es";
  return "en";
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function looksLikeNonTranslation(text = "") {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return true;

  const badMarkers = [
    "ambiguous sentence",
    "provide more context",
    "specify the subject",
    "i don't know",
    "what are you talking about",
    "cannot translate",
    "as an ai",
    "<source>",
    "</source>",
    "i will translate exactly",
    "translate the exact content"
  ];

  return badMarkers.some((marker) => value.includes(marker));
}

function getLanguageProfile(languageCode = "ko-KR") {
  if (languageCode.startsWith("ko")) {
    return {
      languageCode,
      sttHints: ["회의", "안건", "결정", "일정", "담당", "다음 주"],
      transcriptInstruction:
        "Korean (Hangul only). Never translate to English or romaji.",
      notesInstruction: "Korean"
    };
  }
  if (languageCode.startsWith("es")) {
    return {
      languageCode: "es-ES",
      sttHints: ["reunion", "agenda", "decision", "responsable", "la proxima semana"],
      transcriptInstruction: "Spanish.",
      notesInstruction: "Spanish"
    };
  }
  if (languageCode.startsWith("zh")) {
    return {
      languageCode: "zh-CN",
      sttHints: ["会议", "议题", "决定", "负责人", "下周"],
      transcriptInstruction: "Mandarin Chinese in simplified Chinese characters.",
      notesInstruction: "Chinese"
    };
  }
  if (languageCode.startsWith("ja")) {
    return {
      languageCode,
      sttHints: ["会議", "議題", "決定", "担当", "来週"],
      transcriptInstruction:
        "Japanese. Use natural Japanese script (kanji/hiragana/katakana).",
      notesInstruction: "Japanese"
    };
  }
  return {
    languageCode: "en-US",
    sttHints: ["meeting", "agenda", "decision", "timeline", "owner", "next week"],
    transcriptInstruction: "English.",
    notesInstruction: "English"
  };
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

async function translateWithGoogleRest(text, sourceLanguageCode, targetLanguageCode) {
  if (!sttApiKey) {
    throw new Error("No Google API key configured for Google Translate REST.");
  }

  const endpoint = `https://translation.googleapis.com/language/translate/v2?key=${sttApiKey}`;
  const body = {
    q: text,
    target: toTranslateLanguageCode(targetLanguageCode),
    format: "text",
    model: "nmt"
  };

  if (sourceLanguageCode) {
    body.source = toTranslateLanguageCode(sourceLanguageCode);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok || payload?.error) {
    const detail =
      payload?.error?.message || `Google Translate REST HTTP ${response.status}`;
    throw new Error(detail);
  }

  const translatedText = payload?.data?.translations?.[0]?.translatedText;
  if (!translatedText) {
    throw new Error("Google Translate REST returned empty translatedText.");
  }

  return decodeHtmlEntities(translatedText);
}

async function generateTextWithModelFallback(prompt, candidates = geminiModelCandidates) {
  let lastError = null;

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();
      if (looksLikeNonTranslation(responseText)) {
        lastError = new Error(
          `Model ${modelName} returned non-translation text: ${responseText.slice(0, 120)}`
        );
        continue;
      }
      return {
        text: responseText,
        modelName
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      const isModelMismatch =
        message.includes("is not found") ||
        message.includes("is not supported") ||
        message.includes("404");
      if (!isModelMismatch) {
        throw error;
      }
    }
  }

  throw (
    lastError ||
    new Error("No available Gemini model found for this API key.")
  );
}

async function generateNotesTextWithFallback(prompt) {
  return generateTextWithModelFallback(prompt, geminiModelCandidates);
}

async function generateTranslationTextWithFallback(
  prompt,
  candidates = geminiTranslateModelCandidates
) {
  let lastError = null;

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.9
        }
      });
      const result = await model.generateContent(prompt);
      return {
        text: result.response.text(),
        modelName
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      const isModelMismatch =
        message.includes("is not found") ||
        message.includes("is not supported") ||
        message.includes("404");
      if (!isModelMismatch) {
        throw error;
      }
    }
  }

  throw (
    lastError ||
    new Error("No available Gemini translation model found for this API key.")
  );
}

function shouldFallbackToGemini(sttError) {
  const msg = String(sttError?.message || "").toLowerCase();
  return (
    msg.includes("default credentials") ||
    msg.includes("has not been used in project") ||
    msg.includes("api key not valid") ||
    msg.includes("permission denied") ||
    msg.includes("forbidden")
  );
}

async function transcribeWithGeminiFallback(audioContentBase64, mimeType, languageCode) {
  if (!genAI) {
    throw new Error("Gemini is not configured for fallback transcription.");
  }

  const profile = getLanguageProfile(languageCode);
  const transcriptionPrompt = [
    "You are a highly accurate speech-to-text engine.",
    "Transcribe what is spoken in the audio exactly.",
    "Do not summarize. Do not translate.",
    `Output language rule: ${profile.transcriptInstruction}`,
    "Return plain transcript text only (no markdown, no labels)."
  ].join(" ");

  let lastError = null;
  for (const modelName of geminiTranscribeModelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        { text: transcriptionPrompt },
        {
          inlineData: {
            mimeType: mimeType || "audio/webm",
            data: audioContentBase64
          }
        }
      ]);

      const transcript = result.response.text().trim();
      if (!transcript) {
        throw new Error("Gemini returned an empty transcript.");
      }
      return { transcript, modelName };
    } catch (error) {
      lastError = error;
    }
  }

  throw (lastError || new Error("No Gemini transcription model available."));
}

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required." });
    }

    const languageCode = req.body.languageCode || "ko-KR";
    const profile = getLanguageProfile(languageCode);
    const encoding = inferEncoding(req.file.mimetype);
    const mimeType = normalizeMimeType(req.file.mimetype, encoding);

    const config = {
      encoding,
      languageCode: profile.languageCode,
      enableAutomaticPunctuation: true,
      model: "latest_long",
      speechContexts: [{ phrases: profile.sttHints }]
    };
    if (encoding === "ENCODING_UNSPECIFIED") {
      delete config.encoding;
    }

    const audioContentBase64 = req.file.buffer.toString("base64");
    const canUseSpeech = !!speechClient || !!sttApiKey;

    if (canUseSpeech) {
      try {
        const response = speechClient
          ? (await speechClient.recognize({ audio: { content: audioContentBase64 }, config }))[0]
          : await transcribeWithApiKey(audioContentBase64, config);

        const transcript = (response.results || [])
          .map((r) => r.alternatives?.[0]?.transcript || "")
          .join(" ")
          .trim();

        return res.json({
          transcript,
          confidence: response.results?.[0]?.alternatives?.[0]?.confidence ?? null,
          provider: speechClient ? "google-speech-client" : "google-speech-rest"
        });
      } catch (sttError) {
        if (genAI && shouldFallbackToGemini(sttError)) {
          const fallback = await transcribeWithGeminiFallback(
            audioContentBase64,
            mimeType,
            languageCode
          );
          return res.json({
            transcript: fallback.transcript,
            confidence: null,
            provider: `gemini-fallback:${fallback.modelName}`,
            warning: sttError.message
          });
        }
        throw sttError;
      }
    }

    if (genAI) {
      const fallback = await transcribeWithGeminiFallback(
        audioContentBase64,
        mimeType,
        languageCode
      );
      return res.json({
        transcript: fallback.transcript,
        confidence: null,
        provider: `gemini:${fallback.modelName}`
      });
    }

    return res.status(500).json({
      error: "Transcription is not configured.",
      detail:
        "Set GOOGLE_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_STT_API_KEY, or configure GEMINI_API_KEY."
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

    const { transcript, languageCode = "ko-KR" } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "transcript is required." });
    }
    const profile = getLanguageProfile(languageCode);

    const prompt = `
You are a meeting assistant.
Analyze the transcript below and return JSON only.
Keep JSON keys in English exactly as provided.
Write all values in ${profile.notesInstruction}.
Do not add any text outside JSON.
The summary must be comprehensive and faithful to the transcript.
Do not overly compress or omit important discussion points, context, decisions, disagreements, and rationale.
Format:
{
  "summary": "Detailed, comprehensive summary that preserves important details from the full conversation",
  "keyPoints": ["Point 1", "Point 2"],
  "actionItems": [{"owner":"owner", "task":"task", "due":"date or TBD"}],
  "risks": ["risk 1"]
}

Transcript:
${transcript}
`.trim();

    const { text, modelName } = await generateNotesTextWithFallback(prompt);
    const parsed = safeJsonParse(text);

    if (parsed) {
      return res.json({
        summary: parsed.summary || "",
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        model: modelName,
        languageCode: profile.languageCode
      });
    }

    return res.json({
      summary: text,
      keyPoints: [],
      actionItems: [],
      risks: [],
      model: modelName,
      languageCode: profile.languageCode
    });
  } catch (error) {
    console.error("Meeting notes error:", error);
    return res.status(500).json({
      error: "Failed to generate meeting notes.",
      detail: error.message
    });
  }
});

app.post("/api/translate", async (req, res) => {
  try {
    const {
      text,
      sourceLanguageCode = "en-US",
      targetLanguageCode = "ko-KR",
      fast = false
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required." });
    }

    const sourceProfile = getLanguageProfile(sourceLanguageCode);
    const targetProfile = getLanguageProfile(targetLanguageCode);

    if (sttApiKey) {
      try {
        const translatedText = await translateWithGoogleRest(
          text,
          sourceProfile.languageCode,
          targetProfile.languageCode
        );
        return res.json({
          translatedText: translatedText.trim(),
          model: "google-translate-rest",
          sourceLanguageCode: sourceProfile.languageCode,
          targetLanguageCode: targetProfile.languageCode
        });
      } catch (googleError) {
        console.warn("Google Translate REST fallback to Gemini:", googleError.message);
      }
    }

    if (!genAI) {
      return res.status(500).json({
        error: "Translation is not configured.",
        detail:
          "Enable Google Translate API for GOOGLE_STT_API_KEY/GOOGLE_API_KEY, or set GEMINI_API_KEY."
      });
    }

    const prompt = fast
      ? `
You are a precise translator.
Translate the exact content between <source></source> into ${targetProfile.notesInstruction}.
Rules:
- Keep all meaning, facts, named entities, numbers, and intent.
- Do not invent or omit content.
- Keep sentence order.
- Output only translated text in ${targetProfile.notesInstruction}.
- No explanations, no markdown, no labels.

Source language hint: ${sourceProfile.languageCode}
<source>${text}</source>
`.trim()
      : `
You are a real-time interpreter.
Translate the exact content between <source></source> into ${targetProfile.notesInstruction}.
Rules:
- Preserve all facts, names, numbers, requests, and decisions.
- Do not add any information that is not in the source.
- Do not omit important details.
- Keep the same tone and sentence order as much as possible.
- Output translated text only in ${targetProfile.notesInstruction}.
- No explanations, no markdown, no labels.

Source language hint: ${sourceProfile.languageCode}
<source>${text}</source>
`.trim();

    let translatedText = "";
    let modelName = "gemini-unavailable";
    try {
      const generated = await generateTranslationTextWithFallback(
        prompt,
        geminiTranslateModelCandidates
      );
      translatedText = generated.text;
      modelName = generated.modelName;
    } catch (geminiError) {
      return res.json({
        translatedText: text.trim(),
        model: "pass-through",
        warning: geminiError.message,
        sourceLanguageCode: sourceProfile.languageCode,
        targetLanguageCode: targetProfile.languageCode
      });
    }

    return res.json({
      translatedText: translatedText.trim(),
      model: modelName,
      sourceLanguageCode: sourceProfile.languageCode,
      targetLanguageCode: targetProfile.languageCode
    });
  } catch (error) {
    console.error("Translate error:", error);
    return res.status(500).json({
      error: "Failed to translate text.",
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
