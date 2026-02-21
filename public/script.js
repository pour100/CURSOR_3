const recordBtn = document.getElementById("recordBtn");
const refreshBtn = document.getElementById("refreshBtn");
const recordTimer = document.getElementById("recordTimer");
const notesBtn = document.getElementById("notesBtn");
const pdfBtn = document.getElementById("pdfBtn");
const notesOutput = document.getElementById("notesOutput");
const notesTitle = document.getElementById("notesTitle");
const statusText = document.getElementById("status");
const transcriptOriginal = document.getElementById("transcriptOriginal");
const transcriptKorean = document.getElementById("transcriptKorean");
const languageTabs = document.querySelectorAll(".lang-tab");
const themeSwitch = document.getElementById("themeSwitch");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const I18N = {
  "ko-KR": {
    step3: "Step 3. 회의 요약 결과",
    summary: "요약",
    keyPoints: "핵심 포인트",
    actionItems: "액션 아이템",
    risks: "리스크",
    none: "없음",
    unknown: "미정",
    empty: "내용 없음",
    due: "기한",
    model: "모델",
    noResult: "아직 생성된 결과가 없습니다.",
    recording: "실시간 전사/통역 진행 중...",
    stopped: "전사 종료",
    modeSelected: "모드 선택",
    unsupported: "이 브라우저는 실시간 음성 전사를 지원하지 않습니다.",
    startFail: "녹음 시작에 실패했습니다. 브라우저 마이크 권한을 확인하세요.",
    noteBuilding: "회의 요약 생성 중...",
    noteDone: "회의 요약 완료",
    noteFail: "회의 요약 실패",
    noTranscript: "먼저 전사를 진행해주세요.",
    pdfMaking: "PDF 생성 중...",
    pdfDone: "PDF 저장 완료",
    pdfFail: "PDF 생성 실패",
    noPdfData: "저장할 회의 요약이 없습니다.",
    refreshDone: "화면이 초기화되었습니다."
  },
  "en-US": {
    step3: "Step 3. Meeting Summary",
    summary: "Summary",
    keyPoints: "Key Points",
    actionItems: "Action Items",
    risks: "Risks",
    none: "None",
    unknown: "TBD",
    empty: "No details",
    due: "Due",
    model: "Model",
    noResult: "No summary generated yet.",
    recording: "Live transcription/interpretation in progress...",
    stopped: "Transcription stopped",
    modeSelected: "mode selected",
    unsupported: "This browser does not support live speech recognition.",
    startFail: "Failed to start recording. Check microphone permissions.",
    noteBuilding: "Generating meeting summary...",
    noteDone: "Meeting summary completed",
    noteFail: "Meeting summary failed",
    noTranscript: "Run transcription first.",
    pdfMaking: "Generating PDF...",
    pdfDone: "PDF saved",
    pdfFail: "PDF generation failed",
    noPdfData: "No meeting summary to download.",
    refreshDone: "Screen has been reset."
  },
  "ja-JP": {
    step3: "Step 3. 会議要約結果",
    summary: "要約",
    keyPoints: "主要ポイント",
    actionItems: "アクション項目",
    risks: "リスク",
    none: "なし",
    unknown: "未定",
    empty: "内容なし",
    due: "期限",
    model: "モデル",
    noResult: "まだ生成された結果がありません。",
    recording: "リアルタイム文字起こし/通訳を実行中...",
    stopped: "文字起こし終了",
    modeSelected: "モードを選択",
    unsupported: "このブラウザはリアルタイム音声認識に対応していません。",
    startFail: "録音開始に失敗しました。マイク権限を確認してください。",
    noteBuilding: "会議要約を生成中...",
    noteDone: "会議要約が完了しました",
    noteFail: "会議要約に失敗しました",
    noTranscript: "先に文字起こしを実行してください。",
    pdfMaking: "PDFを生成中...",
    pdfDone: "PDFを保存しました",
    pdfFail: "PDF生成に失敗しました",
    noPdfData: "保存する会議要約がありません。",
    refreshDone: "画面を初期化しました。"
  },
  "zh-CN": {
    step3: "Step 3. 会议摘要结果",
    summary: "摘要",
    keyPoints: "关键要点",
    actionItems: "行动项",
    risks: "风险",
    none: "无",
    unknown: "待定",
    empty: "无内容",
    due: "截止时间",
    model: "模型",
    noResult: "尚未生成结果。",
    recording: "实时转写/同传进行中...",
    stopped: "转写已停止",
    modeSelected: "模式已选择",
    unsupported: "当前浏览器不支持实时语音识别。",
    startFail: "录音启动失败，请检查麦克风权限。",
    noteBuilding: "正在生成会议摘要...",
    noteDone: "会议摘要生成完成",
    noteFail: "会议摘要生成失败",
    noTranscript: "请先进行转写。",
    pdfMaking: "正在生成 PDF...",
    pdfDone: "PDF 已保存",
    pdfFail: "PDF 生成失败",
    noPdfData: "没有可下载的会议摘要。",
    refreshDone: "画面已重置。"
  }
};

let selectedLanguage = "ko-KR";
let recognition = null;
let keepListening = false;
let isRecording = false;

let finalOriginalSegments = [];
let finalKoreanSegments = [];
let interimOriginal = "";
let interimKorean = "";
let interimTimer = null;
let interimToken = 0;
let interimTranslateController = null;
const translateCache = new Map();

let timerInterval = null;
let timerStartAt = 0;

function ui() {
  return I18N[selectedLanguage] || I18N["en-US"];
}

function updateStatus(message) {
  statusText.textContent = message;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.setAttribute("data-theme", isDark ? "dark" : "bright");
  themeSwitch.setAttribute("aria-pressed", String(isDark));
  localStorage.setItem("meeting-theme", isDark ? "dark" : "bright");
}

function formatTime(ms) {
  const centiseconds = Math.floor(ms / 10) % 100;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function startTimer() {
  timerStartAt = performance.now();
  recordTimer.textContent = "00:00.00";
  timerInterval = setInterval(() => {
    recordTimer.textContent = formatTime(performance.now() - timerStartAt);
  }, 10);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function resetTimer() {
  stopTimer();
  recordTimer.textContent = "00:00.00";
}

function autoGrowTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 150)}px`;
}

function updateSectionLabels() {
  notesTitle.textContent = ui().step3;
  if (!notesOutput.textContent.trim()) {
    notesOutput.textContent = ui().noResult;
  }
}

function renderTranscriptBoxes() {
  const originalText = [finalOriginalSegments.join(" "), interimOriginal]
    .filter(Boolean)
    .join(" ")
    .trim();
  transcriptOriginal.value = originalText;

  if (selectedLanguage === "ko-KR") {
    transcriptKorean.value = originalText;
  } else {
    const koreanText = [finalKoreanSegments.join(" "), interimKorean]
      .filter(Boolean)
      .join(" ")
      .trim();
    transcriptKorean.value = koreanText;
  }

  autoGrowTextarea(transcriptOriginal);
  autoGrowTextarea(transcriptKorean);
}

async function requestKoreanTranslation(text, options = {}) {
  const key = `${selectedLanguage}:${text}`;
  if (translateCache.has(key)) {
    return translateCache.get(key);
  }

  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      text,
      sourceLanguageCode: selectedLanguage,
      targetLanguageCode: "ko-KR",
      fast: true
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || "translate failed");
  }
  const translated = data.translatedText || "";
  translateCache.set(key, translated);
  return translated;
}

function queueFinalTranslation(segment) {
  if (!segment) return;
  if (selectedLanguage === "ko-KR") {
    finalKoreanSegments.push(segment);
    renderTranscriptBoxes();
    return;
  }

  const idx = finalKoreanSegments.push(segment) - 1;
  requestKoreanTranslation(segment)
    .then((translated) => {
      finalKoreanSegments[idx] = translated || segment;
      renderTranscriptBoxes();
    })
    .catch(() => {
      finalKoreanSegments[idx] = segment;
      renderTranscriptBoxes();
    });
}

function scheduleInterimTranslation() {
  if (selectedLanguage === "ko-KR") {
    interimKorean = interimOriginal;
    renderTranscriptBoxes();
    return;
  }

  clearTimeout(interimTimer);
  const currentInterim = interimOriginal.trim();
  if (!currentInterim) {
    interimKorean = "";
    renderTranscriptBoxes();
    return;
  }

  interimKorean = currentInterim;
  renderTranscriptBoxes();

  const token = ++interimToken;
  interimTimer = setTimeout(async () => {
    if (interimTranslateController) interimTranslateController.abort();
    interimTranslateController = new AbortController();

    try {
      const translated = await requestKoreanTranslation(currentInterim, {
        signal: interimTranslateController.signal
      });
      if (token === interimToken) {
        interimKorean = translated || currentInterim;
        renderTranscriptBoxes();
      }
    } catch (_error) {
      if (token === interimToken) {
        interimKorean = currentInterim;
        renderTranscriptBoxes();
      }
    }
  }, 120);
}

function setupRecognition() {
  if (!SpeechRecognition) return null;

  const instance = new SpeechRecognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = selectedLanguage;
  instance.maxAlternatives = 1;

  instance.onresult = (event) => {
    let nextInterim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = (result[0]?.transcript || "").trim();
      if (!text) continue;
      if (result.isFinal) {
        finalOriginalSegments.push(text);
        queueFinalTranslation(text);
      } else {
        nextInterim += `${text} `;
      }
    }

    interimOriginal = nextInterim.trim();
    renderTranscriptBoxes();
    scheduleInterimTranslation();
  };

  instance.onerror = (event) => {
    updateStatus(`Error: ${event.error}`);
  };

  instance.onend = () => {
    if (keepListening) {
      try {
        instance.start();
      } catch (_error) {
        stopRecording();
      }
    }
  };

  return instance;
}

function renderNotes(data) {
  const t = ui();
  const summary = data.summary || t.none;
  const keyPoints =
    Array.isArray(data.keyPoints) && data.keyPoints.length > 0
      ? data.keyPoints.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
      : t.none;
  const actionItems =
    Array.isArray(data.actionItems) && data.actionItems.length > 0
      ? data.actionItems
          .map((item, idx) => {
            const owner = item.owner || t.unknown;
            const task = item.task || t.empty;
            const due = item.due || t.unknown;
            return `${idx + 1}. [${owner}] ${task} (${t.due}: ${due})`;
          })
          .join("\n")
      : t.none;
  const risks =
    Array.isArray(data.risks) && data.risks.length > 0
      ? data.risks.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
      : t.none;
  const model = data.model ? `\n\n${t.model}: ${data.model}` : "";

  return `${t.summary}\n${summary}\n\n${t.keyPoints}\n${keyPoints}\n\n${t.actionItems}\n${actionItems}\n\n${t.risks}\n${risks}${model}`;
}

function resetTranscriptAndNotes() {
  finalOriginalSegments = [];
  finalKoreanSegments = [];
  interimOriginal = "";
  interimKorean = "";
  interimToken += 1;
  clearTimeout(interimTimer);
  if (interimTranslateController) interimTranslateController.abort();

  transcriptOriginal.value = "";
  transcriptKorean.value = "";
  autoGrowTextarea(transcriptOriginal);
  autoGrowTextarea(transcriptKorean);
  notesOutput.textContent = ui().noResult;
}

function stopRecording() {
  keepListening = false;
  isRecording = false;
  stopTimer();
  recordBtn.classList.remove("recording");
  if (recognition) recognition.stop();
  updateStatus(ui().stopped);
}

function startRecording() {
  if (!SpeechRecognition) {
    updateStatus(ui().unsupported);
    return;
  }

  if (!recognition) recognition = setupRecognition();
  recognition.lang = selectedLanguage;
  keepListening = true;
  isRecording = true;
  recordBtn.classList.add("recording");
  startTimer();
  updateStatus(ui().recording);

  try {
    recognition.start();
  } catch (_error) {
    stopRecording();
    updateStatus(ui().startFail);
  }
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function buildPdfBlob(content) {
  const container = document.createElement("div");
  container.style.padding = "18px";
  container.style.fontFamily = "'Noto Sans KR', sans-serif";
  container.style.fontSize = "13px";
  container.style.lineHeight = "1.6";
  container.style.whiteSpace = "pre-wrap";
  container.style.wordBreak = "break-word";
  container.style.width = "780px";
  container.textContent = content;
  document.body.appendChild(container);

  try {
    const worker = window
      .html2pdf()
      .set({
        margin: 10,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      })
      .from(container)
      .toPdf();
    const pdf = await worker.get("pdf");
    return pdf.output("blob");
  } finally {
    container.remove();
  }
}

async function savePdfBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "PDF files",
          accept: { "application/pdf": [".pdf"] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const pdfFile = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [pdfFile] })) {
    await navigator.share({ files: [pdfFile], title: filename });
    return;
  }

  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

languageTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (isRecording) return;
    languageTabs.forEach((btn) => btn.classList.remove("active"));
    tab.classList.add("active");
    selectedLanguage = tab.dataset.lang || "ko-KR";
    if (recognition) recognition.lang = selectedLanguage;
    updateSectionLabels();
    updateStatus(`${tab.textContent.trim()} ${ui().modeSelected}`);
  });
});

recordBtn.addEventListener("click", toggleRecording);

refreshBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  resetTimer();
  resetTranscriptAndNotes();
  updateSectionLabels();
  updateStatus(ui().refreshDone);
});

notesBtn.addEventListener("click", async () => {
  const transcript = transcriptOriginal.value.trim();
  if (!transcript) {
    updateStatus(ui().noTranscript);
    return;
  }

  try {
    notesBtn.disabled = true;
    updateStatus(ui().noteBuilding);
    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, languageCode: selectedLanguage })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || ui().noteFail);
    notesOutput.textContent = renderNotes(data);
    updateStatus(ui().noteDone);
  } catch (error) {
    updateStatus(`${ui().noteFail}: ${error.message}`);
  } finally {
    notesBtn.disabled = false;
  }
});

pdfBtn.addEventListener("click", async () => {
  const content = notesOutput.textContent.trim();
  if (!content || content === ui().noResult) {
    updateStatus(ui().noPdfData);
    return;
  }

  try {
    pdfBtn.disabled = true;
    updateStatus(ui().pdfMaking);
    const blob = await buildPdfBlob(content);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await savePdfBlob(blob, `meeting-minutes-${stamp}.pdf`);
    updateStatus(ui().pdfDone);
  } catch (error) {
    updateStatus(`${ui().pdfFail}: ${error.message}`);
  } finally {
    pdfBtn.disabled = false;
  }
});

themeSwitch.addEventListener("click", () => {
  const next = document.body.getAttribute("data-theme") === "dark" ? "bright" : "dark";
  applyTheme(next);
});

(function init() {
  const savedTheme = localStorage.getItem("meeting-theme");
  if (savedTheme === "dark" || savedTheme === "bright") {
    applyTheme(savedTheme);
  } else {
    applyTheme("bright");
  }

  resetTimer();
  updateSectionLabels();
  resetTranscriptAndNotes();
  updateStatus("녹음을 시작하세요.");
})();
