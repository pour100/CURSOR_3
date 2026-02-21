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
const appTitle = document.getElementById("appTitle");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const L10N = {
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
    noResult: "아직 생성된 결과가 없습니다.",
    recording: "실시간 전사/통역 진행 중...",
    stopped: "전사 종료",
    modeSelected: "모드 선택",
    unsupported: "이 브라우저는 실시간 음성 인식을 지원하지 않습니다.",
    startFail: "녹음 시작에 실패했습니다. 마이크 권한을 확인하세요.",
    noteBuilding: "회의 요약 생성 중...",
    noteDone: "회의 요약 완료",
    noteFail: "회의 요약 실패",
    noTranscript: "먼저 전사를 진행해주세요.",
    pdfMaking: "PDF 생성 중...",
    pdfDone: "PDF 저장 완료",
    pdfFail: "PDF 생성 실패",
    noPdfData: "저장할 회의 요약이 없습니다.",
    refreshDone: "화면이 초기화되었습니다.",
    wakeLockFail: "화면 꺼짐 방지 기능을 사용할 수 없습니다."
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
    refreshDone: "Screen has been reset.",
    wakeLockFail: "Wake lock is not available on this browser."
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
    refreshDone: "画面を初期化しました。",
    wakeLockFail: "画面スリープ防止機能を使えません。"
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
    refreshDone: "画面已重置。",
    wakeLockFail: "无法使用防休眠功能。"
  }
};

let selectedLanguage = "ko-KR";
let recognition = null;
let keepListening = false;
let isRecording = false;
let wakeLock = null;

let finalOriginalSegments = [];
let finalKoreanSegments = [];
let interimOriginal = "";
let interimKorean = "";
let interimTimer = null;
let interimToken = 0;
let interimTranslateController = null;
const translateCache = new Map();

let timerInterval = null;
let elapsedMs = 0;
let runningStartedAt = 0;

function t() {
  return L10N[selectedLanguage] || L10N["en-US"];
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateStatus(message) {
  statusText.textContent = message;
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.setAttribute("data-theme", dark ? "dark" : "bright");
  themeSwitch.setAttribute("aria-pressed", String(dark));
  localStorage.setItem("meeting-theme", dark ? "dark" : "bright");
}

function fitTitleOneLine() {
  if (!appTitle) return;
  let size = window.innerWidth < 840 ? 34 : 64;
  appTitle.style.fontSize = `${size}px`;
  appTitle.style.whiteSpace = "nowrap";
  while (size > 12 && appTitle.scrollWidth > appTitle.clientWidth) {
    size -= 1;
    appTitle.style.fontSize = `${size}px`;
  }
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
  if (timerInterval) return;
  runningStartedAt = performance.now();
  timerInterval = setInterval(() => {
    const live = elapsedMs + (performance.now() - runningStartedAt);
    recordTimer.textContent = formatTime(live);
  }, 10);
}

function stopTimer() {
  if (!timerInterval) return;
  elapsedMs += performance.now() - runningStartedAt;
  clearInterval(timerInterval);
  timerInterval = null;
  recordTimer.textContent = formatTime(elapsedMs);
}

function resetTimer() {
  stopTimer();
  elapsedMs = 0;
  runningStartedAt = 0;
  recordTimer.textContent = "00:00.00";
}

function autoGrowTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 150)}px`;
}

function updateSectionLabels() {
  const label = t().step3.replace(/^Step 3\.\s*/i, "");
  notesTitle.innerHTML = `<span class="step-chip">Step 3</span> ${label}`;
  if (!notesOutput.textContent.trim()) {
    notesOutput.textContent = t().noResult;
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
  if (translateCache.has(key)) return translateCache.get(key);

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
  if (!response.ok) throw new Error(data.detail || data.error || "translate failed");

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

  const index = finalKoreanSegments.push(interimKorean || segment) - 1;
  requestKoreanTranslation(segment)
    .then((translated) => {
      finalKoreanSegments[index] = translated || segment;
      renderTranscriptBoxes();
    })
    .catch(() => {
      finalKoreanSegments[index] = segment;
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
  }, 50);
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

function renderNotesHtml(data) {
  const tr = t();
  const summary = escapeHtml(data.summary || tr.none);
  const keyPoints =
    Array.isArray(data.keyPoints) && data.keyPoints.length > 0
      ? data.keyPoints.map((item, idx) => `${idx + 1}. ${escapeHtml(item)}`).join("<br>")
      : escapeHtml(tr.none);
  const actionItems =
    Array.isArray(data.actionItems) && data.actionItems.length > 0
      ? data.actionItems
          .map((item, idx) => {
            const owner = escapeHtml(item.owner || tr.unknown);
            const task = escapeHtml(item.task || tr.empty);
            const due = escapeHtml(item.due || tr.unknown);
            return `${idx + 1}. [${owner}] ${task} (${escapeHtml(tr.due)}: ${due})`;
          })
          .join("<br>")
      : escapeHtml(tr.none);
  const risks =
    Array.isArray(data.risks) && data.risks.length > 0
      ? data.risks.map((item, idx) => `${idx + 1}. ${escapeHtml(item)}`).join("<br>")
      : escapeHtml(tr.none);

  return [
    `<strong>${escapeHtml(tr.summary)}</strong><br>${summary}`,
    `<strong>${escapeHtml(tr.keyPoints)}</strong><br>${keyPoints}`,
    `<strong>${escapeHtml(tr.actionItems)}</strong><br>${actionItems}`,
    `<strong>${escapeHtml(tr.risks)}</strong><br>${risks}`
  ].join("<br><br>");
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
  notesOutput.textContent = t().noResult;
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
    updateStatus(t().wakeLockFail);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}

function stopRecording() {
  keepListening = false;
  isRecording = false;
  stopTimer();
  recordBtn.classList.remove("recording");
  if (recognition) recognition.stop();
  releaseWakeLock();
  updateStatus(t().stopped);
}

function startRecording() {
  if (!SpeechRecognition) {
    updateStatus(t().unsupported);
    return;
  }

  if (!recognition) recognition = setupRecognition();
  recognition.lang = selectedLanguage;
  keepListening = true;
  isRecording = true;
  recordBtn.classList.add("recording");
  startTimer();
  updateStatus(t().recording);
  requestWakeLock();

  try {
    recognition.start();
  } catch (_error) {
    stopRecording();
    updateStatus(t().startFail);
  }
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

async function buildPdfBlob(contentHtml) {
  const renderNode = document.createElement("div");
  renderNode.style.position = "fixed";
  renderNode.style.left = "-10000px";
  renderNode.style.top = "0";
  renderNode.style.width = "800px";
  renderNode.style.background = "#fff";
  renderNode.style.color = "#111";
  renderNode.style.padding = "24px";
  renderNode.style.fontFamily = "'Noto Sans KR', sans-serif";
  renderNode.style.fontSize = "14px";
  renderNode.style.lineHeight = "1.6";
  renderNode.innerHTML = contentHtml;
  document.body.appendChild(renderNode);

  try {
    const canvas = await window.html2canvas(renderNode, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff"
    });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let position = 0;
    let remaining = imgHeight;
    pdf.addImage(imgData, "PNG", margin, margin, imgWidth, imgHeight);
    remaining -= pageHeight - margin * 2;
    position -= pageHeight - margin * 2;

    while (remaining > 0) {
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, margin + position, imgWidth, imgHeight);
      remaining -= pageHeight - margin * 2;
      position -= pageHeight - margin * 2;
    }

    return pdf.output("blob");
  } finally {
    renderNode.remove();
  }
}

async function savePdfBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "PDF files", accept: { "application/pdf": [".pdf"] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
    updateStatus(`${tab.textContent.trim()} ${t().modeSelected}`);
  });
});

recordBtn.addEventListener("click", toggleRecording);

refreshBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  resetTimer();
  resetTranscriptAndNotes();
  updateSectionLabels();
  updateStatus(t().refreshDone);
});

notesBtn.addEventListener("click", async () => {
  const transcript = transcriptOriginal.value.trim();
  if (!transcript) {
    updateStatus(t().noTranscript);
    return;
  }

  try {
    notesBtn.disabled = true;
    updateStatus(t().noteBuilding);
    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, languageCode: selectedLanguage })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || t().noteFail);
    notesOutput.innerHTML = renderNotesHtml(data);
    updateStatus(t().noteDone);
  } catch (error) {
    updateStatus(`${t().noteFail}: ${error.message}`);
  } finally {
    notesBtn.disabled = false;
  }
});

pdfBtn.addEventListener("click", async () => {
  const raw = notesOutput.textContent.trim();
  if (!raw || raw === t().noResult) {
    updateStatus(t().noPdfData);
    return;
  }

  try {
    pdfBtn.disabled = true;
    updateStatus(t().pdfMaking);
    const blob = await buildPdfBlob(notesOutput.innerHTML);
    if (!blob || blob.size < 128) throw new Error("empty pdf");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await savePdfBlob(blob, `meeting-minutes-${stamp}.pdf`);
    updateStatus(t().pdfDone);
  } catch (error) {
    updateStatus(`${t().pdfFail}: ${error.message}`);
  } finally {
    pdfBtn.disabled = false;
  }
});

themeSwitch.addEventListener("click", () => {
  const next = document.body.getAttribute("data-theme") === "dark" ? "bright" : "dark";
  applyTheme(next);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isRecording) {
    requestWakeLock();
  }
});

window.addEventListener("resize", fitTitleOneLine);

(function init() {
  const savedTheme = localStorage.getItem("meeting-theme");
  applyTheme(savedTheme === "dark" ? "dark" : "bright");
  resetTimer();
  updateSectionLabels();
  resetTranscriptAndNotes();
  updateStatus("녹음을 시작하세요.");
  fitTitleOneLine();
})();
