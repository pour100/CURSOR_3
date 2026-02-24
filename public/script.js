const startMeetingBtn = document.getElementById("startMeetingBtn");
const startMeetingLabel = document.getElementById("startMeetingLabel");
const meetingTimer = document.getElementById("meetingTimer");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");

const meetingLanguageSelect = document.getElementById("meetingLanguage");
const interpretationLanguageSelect = document.getElementById("interpretationLanguage");
const minuteLanguageSelect = document.getElementById("minuteLanguage");

const meetingTranscript = document.getElementById("meetingTranscript");
const interpretationTranscript = document.getElementById("interpretationTranscript");

const generateMinutesBtn = document.getElementById("generateMinutesBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const minutesOutput = document.getElementById("minutesOutput");
const appTitle = document.getElementById("appTitle");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const DEFAULT_MINUTES_TEXT = "No minutes generated yet.";
const LANGUAGE_NAMES = {
  "ko-KR": "Korean",
  "en-US": "English",
  "zh-CN": "Chinese",
  "ja-JP": "Japanese",
  "es-ES": "Spanish"
};

let recognition = null;
let keepListening = false;
let isRecording = false;
let wakeLock = null;

let finalMeetingSegments = [];
let finalInterpretationSegments = [];
let interimMeetingSegment = "";
let interimInterpretationSegment = "";
let translationCache = new Map();

let interimTranslateTimer = null;
let interimTranslateToken = 0;
let interimAbortController = null;
let interpretationRunId = 0;
let lastInterimTranslationSource = "";
let finalTranslationQueue = Promise.resolve();

let timerInterval = null;
let elapsedMs = 0;
let runningStartAt = 0;

let latestMinutes = null;

function languageName(code) {
  return LANGUAGE_NAMES[code] || code || "Unknown";
}

function languageFamily(code) {
  return String(code || "").split("-")[0];
}

function isSameLanguage(sourceCode, targetCode) {
  return languageFamily(sourceCode) === languageFamily(targetCode);
}

function fitTitleToSingleLine() {
  if (!appTitle) return;
  const fontSize = window.innerWidth < 860 ? 30 : 64;
  appTitle.style.fontSize = `${fontSize}px`;
  appTitle.style.whiteSpace = "nowrap";
}

function normalizeSegment(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[.,!?/\\\-~:;()[\]{}"']/g, "")
    .trim()
    .toLowerCase();
}

function shouldAppendFinalMeetingSegment(segment) {
  const candidate = normalizeSegment(segment);
  if (!candidate) return false;
  const lastSegment = finalMeetingSegments[finalMeetingSegments.length - 1];
  const last = normalizeSegment(lastSegment);
  if (!last) return true;
  if (candidate === last) return false;
  if (candidate.length < 22 && (last.endsWith(candidate) || candidate.endsWith(last))) {
    return false;
  }
  return true;
}

function ensureSentenceEnding(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}

function detectScriptCount(text, expression) {
  return (String(text || "").match(expression) || []).length;
}

function isTranslationLikelyInvalid(translatedText, targetLanguageCode, sourceText) {
  const translated = String(translatedText || "").trim();
  if (!translated) return true;

  const source = String(sourceText || "").trim();
  const sourceNorm = source.replace(/\s+/g, " ").toLowerCase();
  const translatedNorm = translated.replace(/\s+/g, " ").toLowerCase();

  if (sourceNorm.length > 16 && translatedNorm.includes(sourceNorm.slice(0, 18))) {
    return true;
  }

  const visibleChars = translated.replace(/\s/g, "");
  const len = visibleChars.length || 1;
  const hangul = detectScriptCount(visibleChars, /[\u3131-\u318e\uac00-\ud7a3]/g) / len;
  const latin = detectScriptCount(visibleChars, /[A-Za-z]/g) / len;
  const han = detectScriptCount(visibleChars, /[\u4e00-\u9fff]/g) / len;
  const kana = detectScriptCount(visibleChars, /[\u3040-\u30ff]/g) / len;

  if (targetLanguageCode.startsWith("ko")) return hangul >= 0.18;
  if (targetLanguageCode.startsWith("en")) return latin >= 0.35;
  if (targetLanguageCode.startsWith("es")) return latin >= 0.28;
  if (targetLanguageCode.startsWith("ja")) return kana + han >= 0.18;
  if (targetLanguageCode.startsWith("zh")) return han >= 0.28;
  return true;
}

function updateStatus(message) {
  statusText.textContent = message;
}

function playTapFeedback() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const context = playTapFeedback._ctx || new AudioCtx();
    playTapFeedback._ctx = context;
    if (context.state === "suspended") {
      context.resume();
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(920, now);
    oscillator.frequency.exponentialRampToValueAtTime(700, now + 0.06);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.075);
  } catch (_error) {
    // Ignore feedback errors in unsupported environments.
  }
}

function installTapFeedback() {
  const interactiveNodes = document.querySelectorAll("button, select");
  interactiveNodes.forEach((node) => {
    node.addEventListener(
      "pointerdown",
      () => {
        playTapFeedback();
      },
      { passive: true }
    );
  });
}

function updateStartButtonState() {
  if (isRecording) {
    startMeetingBtn.classList.add("recording");
    startMeetingLabel.textContent = "Stop Meeting";
  } else {
    startMeetingBtn.classList.remove("recording");
    startMeetingLabel.textContent = "Start Meeting";
  }
}

function setLanguageControlsDisabled(disabled) {
  meetingLanguageSelect.disabled = disabled;
  interpretationLanguageSelect.disabled = disabled;
  minuteLanguageSelect.disabled = disabled;
}

function formatTime(milliseconds) {
  const centiseconds = Math.floor(milliseconds / 10) % 100;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const minutes = Math.floor(milliseconds / 60000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function startTimer() {
  if (timerInterval) return;
  runningStartAt = performance.now();
  timerInterval = setInterval(() => {
    const total = elapsedMs + (performance.now() - runningStartAt);
    meetingTimer.textContent = formatTime(total);
  }, 10);
}

function stopTimer() {
  if (!timerInterval) return;
  elapsedMs += performance.now() - runningStartAt;
  clearInterval(timerInterval);
  timerInterval = null;
  meetingTimer.textContent = formatTime(elapsedMs);
}

function resetTimer() {
  stopTimer();
  elapsedMs = 0;
  runningStartAt = 0;
  meetingTimer.textContent = "00:00.00";
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(140, textarea.scrollHeight)}px`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function composeTranscript(finalSegments, interimSegment) {
  return [...finalSegments, interimSegment]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTranscriptBoxes() {
  const sourceLanguage = meetingLanguageSelect.value;
  const targetLanguage = interpretationLanguageSelect.value;

  const sourceText = composeTranscript(finalMeetingSegments, interimMeetingSegment);
  meetingTranscript.value = sourceText;

  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    interpretationTranscript.value = sourceText;
  } else {
    interpretationTranscript.value = composeTranscript(
      finalInterpretationSegments,
      interimInterpretationSegment
    );
  }

  autoGrow(meetingTranscript);
  autoGrow(interpretationTranscript);
}

function clearInterimTranslationWork() {
  clearTimeout(interimTranslateTimer);
  interimTranslateTimer = null;
  interimTranslateToken += 1;
  if (interimAbortController) {
    interimAbortController.abort();
    interimAbortController = null;
  }
}

async function translateText(text, sourceLanguageCode, targetLanguageCode, options = {}) {
  if (!text || !text.trim()) return "";
  if (isSameLanguage(sourceLanguageCode, targetLanguageCode)) return text;

  const fast = options.fast !== false;
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 4200;
  const cacheKey = `${sourceLanguageCode}|${targetLanguageCode}|${fast ? "fast" : "full"}|${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  let externalAbortHandler = null;
  if (options.signal) {
    externalAbortHandler = () => timeoutController.abort();
    options.signal.addEventListener("abort", externalAbortHandler, { once: true });
  }

  try {
    let payload = {};
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: timeoutController.signal,
      body: JSON.stringify({
        text,
        sourceLanguageCode,
        targetLanguageCode,
        fast
      })
    });
    const raw = await response.text();
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (_error) {
      payload = {};
    }
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || raw || "Translation failed");
    }

    const translatedText = payload.translatedText || "";
    translationCache.set(cacheKey, translatedText);
    return translatedText;
  } finally {
    clearTimeout(timer);
    if (externalAbortHandler && options.signal) {
      options.signal.removeEventListener("abort", externalAbortHandler);
    }
  }
}

async function translateTextWithRetry(text, sourceLanguageCode, targetLanguageCode, options = {}) {
  const attemptModes = [true, false];
  let lastError = null;
  let fallbackCandidate = "";

  for (const fastMode of attemptModes) {
    try {
      const translated = await translateText(text, sourceLanguageCode, targetLanguageCode, {
        signal: options.signal,
        fast: fastMode,
        timeoutMs: fastMode ? 2500 : 5200
      });
      if (translated && !fallbackCandidate) {
        fallbackCandidate = translated;
      }
      if (!isTranslationLikelyInvalid(translated, targetLanguageCode, text)) {
        return translated;
      }
      lastError = new Error("Detected mixed-language translation output.");
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    }
  }

  if (fallbackCandidate) return fallbackCandidate;
  throw lastError || new Error("Translation failed");
}

function queueFinalInterpretation(segment, runId) {
  const sourceLanguage = meetingLanguageSelect.value;
  const targetLanguage = interpretationLanguageSelect.value;

  if (!segment) return;
  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    finalInterpretationSegments.push(segment);
    renderTranscriptBoxes();
    return;
  }

  const segmentIndex = finalInterpretationSegments.push(segment) - 1;

  finalTranslationQueue = finalTranslationQueue
    .catch(() => {})
    .then(async () => {
      try {
        const translatedText = await translateTextWithRetry(
          segment,
          sourceLanguage,
          targetLanguage
        );
        if (runId !== interpretationRunId) return;
        finalInterpretationSegments[segmentIndex] = translatedText || segment;
      } catch (_error) {
        if (runId !== interpretationRunId) return;
        finalInterpretationSegments[segmentIndex] = segment;
      } finally {
        if (runId === interpretationRunId) {
          renderTranscriptBoxes();
        }
      }
    });
}

function scheduleInterimInterpretation(runId) {
  const sourceLanguage = meetingLanguageSelect.value;
  const targetLanguage = interpretationLanguageSelect.value;

  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    interimInterpretationSegment = interimMeetingSegment;
    renderTranscriptBoxes();
    return;
  }

  clearInterimTranslationWork();

  const text = interimMeetingSegment.trim();
  if (!text) {
    interimInterpretationSegment = "";
    lastInterimTranslationSource = "";
    renderTranscriptBoxes();
    return;
  }
  if (text === lastInterimTranslationSource) return;
  lastInterimTranslationSource = text;

  const token = ++interimTranslateToken;
  interimTranslateTimer = setTimeout(async () => {
    if (interimAbortController) interimAbortController.abort();
    interimAbortController = new AbortController();

    try {
      const translatedText = await translateTextWithRetry(text, sourceLanguage, targetLanguage, {
        signal: interimAbortController.signal
      });
      if (token !== interimTranslateToken || runId !== interpretationRunId) return;
      interimInterpretationSegment = translatedText || text;
      renderTranscriptBoxes();
    } catch (_error) {
      if (token !== interimTranslateToken || runId !== interpretationRunId) return;
      interimInterpretationSegment = text;
      renderTranscriptBoxes();
    }
  }, 220);
}

function setupRecognition() {
  if (!SpeechRecognition) return null;

  const instance = new SpeechRecognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.maxAlternatives = 1;
  instance.lang = meetingLanguageSelect.value;

  instance.onresult = (event) => {
    const runId = interpretationRunId;
    let interimText = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = (result[0]?.transcript || "").trim();
      if (!text) continue;

      if (result.isFinal) {
        const endedText = ensureSentenceEnding(text);
        if (shouldAppendFinalMeetingSegment(endedText)) {
          finalMeetingSegments.push(endedText);
          queueFinalInterpretation(endedText, runId);
        }
      } else {
        interimText += `${text} `;
      }
    }

    interimMeetingSegment = interimText.trim();
    renderTranscriptBoxes();
    scheduleInterimInterpretation(runId);
  };

  instance.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    updateStatus(`Recognition error: ${event.error}`);
  };

  instance.onend = () => {
    if (!keepListening) return;
    try {
      instance.lang = meetingLanguageSelect.value;
      instance.start();
    } catch (_error) {
      setTimeout(() => {
        if (!keepListening) return;
        try {
          instance.lang = meetingLanguageSelect.value;
          instance.start();
        } catch (_error2) {
          stopRecording("Recorder stopped unexpectedly.");
        }
      }, 250);
    }
  };

  return instance;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock && isRecording) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch (_error) {
    updateStatus("Wake lock is not supported in this browser.");
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (_error) {
    wakeLock = null;
  }
}

function stopRecording(message = "Meeting paused.") {
  keepListening = false;
  isRecording = false;

  stopTimer();
  clearInterimTranslationWork();

  interimMeetingSegment = "";
  interimInterpretationSegment = "";
  lastInterimTranslationSource = "";
  renderTranscriptBoxes();

  setLanguageControlsDisabled(false);
  updateStartButtonState();
  releaseWakeLock();

  if (recognition) {
    try {
      recognition.stop();
    } catch (_error) {
      // no-op
    }
  }

  if (message) updateStatus(message);
}

function startRecording() {
  if (!SpeechRecognition) {
    updateStatus("This browser does not support real-time speech recognition.");
    return;
  }

  if (!recognition) recognition = setupRecognition();
  if (!recognition) {
    updateStatus("Speech recognition is not available.");
    return;
  }

  interpretationRunId += 1;
  finalTranslationQueue = Promise.resolve();
  lastInterimTranslationSource = "";
  recognition.lang = meetingLanguageSelect.value;
  keepListening = true;
  isRecording = true;

  setLanguageControlsDisabled(true);
  updateStartButtonState();
  startTimer();
  requestWakeLock();

  updateStatus(
    `Listening in ${languageName(meetingLanguageSelect.value)}. Interpreting to ${languageName(
      interpretationLanguageSelect.value
    )}.`
  );

  try {
    recognition.start();
  } catch (_error) {
    stopRecording("");
    updateStatus("Microphone start failed. Please allow microphone access.");
  }
}

function resetMinutesOutput() {
  latestMinutes = null;
  minutesOutput.textContent = DEFAULT_MINUTES_TEXT;
}

function resetTranscripts() {
  interpretationRunId += 1;
  clearInterimTranslationWork();
  finalTranslationQueue = Promise.resolve();

  finalMeetingSegments = [];
  finalInterpretationSegments = [];
  interimMeetingSegment = "";
  interimInterpretationSegment = "";
  lastInterimTranslationSource = "";

  meetingTranscript.value = "";
  interpretationTranscript.value = "";
  autoGrow(meetingTranscript);
  autoGrow(interpretationTranscript);
}

function hardReset() {
  if (isRecording) stopRecording("");
  translationCache = new Map();
  resetTimer();
  resetTranscripts();
  resetMinutesOutput();
  setLanguageControlsDisabled(false);
  updateStartButtonState();
  updateStatus("Screen reset.");
}

async function retranslateAllFinalSegments() {
  const sourceLanguage = meetingLanguageSelect.value;
  const targetLanguage = interpretationLanguageSelect.value;
  const runId = ++interpretationRunId;

  clearInterimTranslationWork();
  finalTranslationQueue = Promise.resolve();
  lastInterimTranslationSource = "";
  interimInterpretationSegment = "";
  finalInterpretationSegments = [];
  renderTranscriptBoxes();

  if (finalMeetingSegments.length === 0) return;
  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    finalInterpretationSegments = [...finalMeetingSegments];
    renderTranscriptBoxes();
    return;
  }

  for (const segment of finalMeetingSegments) {
    let translated = segment;
    try {
      translated = await translateTextWithRetry(segment, sourceLanguage, targetLanguage);
    } catch (_error) {
      translated = segment;
    }

    if (runId !== interpretationRunId) return;
    finalInterpretationSegments.push(translated || segment);
    renderTranscriptBoxes();
  }
}

function buildQuickMinutes(transcript) {
  const compact = String(transcript || "").replace(/\s+/g, " ").trim();
  const sentences = compact
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const summary = sentences.slice(0, 10).join(" ").slice(0, 2200) || compact.slice(0, 2200);
  const keyPoints = sentences.slice(0, 6).map((item) => item.slice(0, 220));
  const actionPattern = /(\bwill\b|\bshould\b|\bneed to\b|\bmust\b|\baction\b|\btodo\b)/i;
  const riskPattern = /(\brisk\b|\bissue\b|\bblocker\b|\bdelay\b|\bconcern\b|\bproblem\b)/i;
  const actionItems = sentences
    .filter((item) => actionPattern.test(item))
    .slice(0, 6)
    .map((task) => ({ owner: "TBD", task: task.slice(0, 220), due: "TBD" }));
  const risks = sentences
    .filter((item) => riskPattern.test(item))
    .slice(0, 6)
    .map((item) => item.slice(0, 220));
  return {
    summary: summary || "None",
    keyPoints,
    actionItems,
    risks
  };
}
function normalizeNotesResponse(payload) {
  const summary = payload.summary || "";
  const keyPoints = Array.isArray(payload.keyPoints) ? payload.keyPoints : [];
  const actionItems = Array.isArray(payload.actionItems) ? payload.actionItems : [];
  const risks = Array.isArray(payload.risks) ? payload.risks : [];
  return { summary, keyPoints, actionItems, risks };
}

function renderMinutesHtml(minutesData) {
  const summary = escapeHtml(minutesData.summary || "None");
  const keyPoints =
    minutesData.keyPoints.length > 0
      ? minutesData.keyPoints.map((item, i) => `${i + 1}. ${escapeHtml(item)}`).join("<br>")
      : "None";
  const actionItems =
    minutesData.actionItems.length > 0
      ? minutesData.actionItems
          .map((item, i) => {
            const owner = escapeHtml(item.owner || "TBD");
            const task = escapeHtml(item.task || "No details");
            const due = escapeHtml(item.due || "TBD");
            return `${i + 1}. [${owner}] ${task} (Due: ${due})`;
          })
          .join("<br>")
      : "None";
  const risks =
    minutesData.risks.length > 0
      ? minutesData.risks.map((item, i) => `${i + 1}. ${escapeHtml(item)}`).join("<br>")
      : "None";

  return [
    `<strong>&#9679; Summary</strong><br>${summary}`,
    `<strong>&#9679; Key Points</strong><br>${keyPoints}`,
    `<strong>&#9679; Action Items</strong><br>${actionItems}`,
    `<strong>&#9679; Risks</strong><br>${risks}`
  ].join("<br><br>");
}

function renderMinutesText(minutesData) {
  const lines = [];
  lines.push("* Summary");
  lines.push(minutesData.summary || "None");
  lines.push("");
  lines.push("* Key Points");
  if (minutesData.keyPoints.length > 0) {
    minutesData.keyPoints.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  } else {
    lines.push("None");
  }
  lines.push("");
  lines.push("* Action Items");
  if (minutesData.actionItems.length > 0) {
    minutesData.actionItems.forEach((item, index) => {
      const owner = item.owner || "TBD";
      const task = item.task || "No details";
      const due = item.due || "TBD";
      lines.push(`${index + 1}. [${owner}] ${task} (Due: ${due})`);
    });
  } else {
    lines.push("None");
  }
  lines.push("");
  lines.push("* Risks");
  if (minutesData.risks.length > 0) {
    minutesData.risks.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  } else {
    lines.push("None");
  }
  return lines.join("\n");
}
async function buildPdfBlobFromText(text) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  const margin = 40;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const lineHeight = 18;
  const usableWidth = pageWidth - margin * 2;

  let y = margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("Meeting Minute", pageWidth / 2, y, { align: "center" });
  y += 30;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);

  const lines = pdf.splitTextToSize(text, usableWidth);
  for (const line of lines) {
    if (y > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += lineHeight;
  }

  return pdf.output("blob");
}

async function buildPdfBlobFromHtml(htmlContent) {
  if (!window.html2canvas) {
    return buildPdfBlobFromText(renderMinutesText(latestMinutes));
  }

  const captureNode = document.createElement("section");
  captureNode.style.position = "fixed";
  captureNode.style.left = "-10000px";
  captureNode.style.top = "0";
  captureNode.style.width = "780px";
  captureNode.style.padding = "28px";
  captureNode.style.background = "#ffffff";
  captureNode.style.color = "#111111";
  captureNode.style.fontFamily = "'Manrope', 'Noto Sans', sans-serif";
  captureNode.style.fontSize = "14px";
  captureNode.style.lineHeight = "1.6";
  captureNode.innerHTML = `
    <h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;text-align:center;">Meeting Minute</h1>
    ${htmlContent}
  `;

  document.body.appendChild(captureNode);

  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await window.html2canvas(captureNode, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true
    });

    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const margin = 24;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;

    let offsetY = 0;
    let remainingHeight = imageHeight;

    pdf.addImage(imgData, "PNG", margin, margin, imageWidth, imageHeight);
    remainingHeight -= pageHeight - margin * 2;
    offsetY -= pageHeight - margin * 2;

    while (remainingHeight > 0) {
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, margin + offsetY, imageWidth, imageHeight);
      remainingHeight -= pageHeight - margin * 2;
      offsetY -= pageHeight - margin * 2;
    }

    return pdf.output("blob");
  } finally {
    captureNode.remove();
  }
}

async function savePdfBlob(blob, filename) {
  let lastError = null;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "picker";
    } catch (error) {
      lastError = error;
    }
  }
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Meeting Minutes",
        text: "Save the generated minutes PDF."
      });
      return "share";
    } catch (error) {
      if (error?.name === "AbortError") {
        return "share-cancelled";
      }
      lastError = error;
    }
  }
  try {
    const fileUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(fileUrl), 3000);
    return "download";
  } catch (error) {
    lastError = error;
  }
  try {
    const fileUrl = URL.createObjectURL(blob);
    window.open(fileUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(fileUrl), 10000);
    return "open";
  } catch (error) {
    lastError = error;
  }
  throw lastError || new Error("Unable to save PDF in this browser.");
}
async function generateMinutes() {
  const transcript = meetingTranscript.value.trim();
  if (!transcript) {
    updateStatus("No transcription text available yet.");
    return;
  }

  const quickMinutes = buildQuickMinutes(transcript);
  latestMinutes = quickMinutes;
  minutesOutput.innerHTML = renderMinutesHtml(quickMinutes);
  let timeoutId = null;

  try {
    generateMinutesBtn.disabled = true;
    updateStatus(
      `Quick minutes ready. Refining in ${languageName(minuteLanguageSelect.value)}...`
    );

    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 18000);

    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        transcript,
        languageCode: minuteLanguageSelect.value
      })
    });
    clearTimeout(timeoutId);

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Failed to generate minutes");
    }

    latestMinutes = normalizeNotesResponse(payload);
    minutesOutput.innerHTML = renderMinutesHtml(latestMinutes);
    updateStatus("Minutes generated successfully.");
  } catch (error) {
    updateStatus(`Using quick minutes mode: ${error.message}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    generateMinutesBtn.disabled = false;
  }
}

async function downloadMinutesPdf() {
  if (!latestMinutes) {
    updateStatus("No minutes available to download.");
    return;
  }

  try {
    downloadPdfBtn.disabled = true;
    updateStatus("Building PDF...");

    const htmlContent = minutesOutput.innerHTML;
    let pdfBlob = await buildPdfBlobFromHtml(htmlContent);
    if (!pdfBlob || pdfBlob.size < 256) {
      pdfBlob = await buildPdfBlobFromText(renderMinutesText(latestMinutes));
    }
    if (!pdfBlob || pdfBlob.size < 128) {
      throw new Error("Generated PDF is empty");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `meeting-minutes-${timestamp}.pdf`;
    const method = await savePdfBlob(pdfBlob, filename);

    if (method === "picker") {
      updateStatus("PDF saved with selected path.");
    } else if (method === "share") {
      updateStatus("Share sheet opened. Choose where to save the PDF.");
    } else if (method === "share-cancelled") {
      updateStatus("Share was canceled.");
    } else if (method === "open") {
      updateStatus("PDF opened in a new tab.");
    } else {
      updateStatus("PDF download started.");
    }
  } catch (error) {
    updateStatus(`PDF download failed: ${error.message}`);
  } finally {
    downloadPdfBtn.disabled = false;
  }
}

startMeetingBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

refreshBtn.addEventListener("click", () => {
  hardReset();
});

generateMinutesBtn.addEventListener("click", () => {
  generateMinutes();
});

downloadPdfBtn.addEventListener("click", () => {
  downloadMinutesPdf();
});

meetingLanguageSelect.addEventListener("change", () => {
  if (isRecording) return;
  if (recognition) recognition.lang = meetingLanguageSelect.value;
  retranslateAllFinalSegments();
  updateStatus(`Meeting language set to ${languageName(meetingLanguageSelect.value)}.`);
});

interpretationLanguageSelect.addEventListener("change", () => {
  if (isRecording) return;
  retranslateAllFinalSegments();
  updateStatus(`Interpretation language set to ${languageName(interpretationLanguageSelect.value)}.`);
});

minuteLanguageSelect.addEventListener("change", () => {
  updateStatus(`Minute language set to ${languageName(minuteLanguageSelect.value)}.`);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isRecording) {
    requestWakeLock();
  }
});

window.addEventListener("resize", () => {
  fitTitleToSingleLine();
  autoGrow(meetingTranscript);
  autoGrow(interpretationTranscript);
});

(function init() {
  resetTimer();
  resetTranscripts();
  resetMinutesOutput();
  updateStartButtonState();
  installTapFeedback();
  updateStatus("Ready to start.");
  fitTitleToSingleLine();
})();

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    fitTitleToSingleLine();
  });
}
