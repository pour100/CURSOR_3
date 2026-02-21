const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const notesBtn = document.getElementById("notesBtn");
const pdfBtn = document.getElementById("pdfBtn");
const notesOutput = document.getElementById("notesOutput");
const statusText = document.getElementById("status");
const statusPill = document.getElementById("statusPill");
const transcriptOriginal = document.getElementById("transcriptOriginal");
const transcriptKorean = document.getElementById("transcriptKorean");
const languageTabs = document.querySelectorAll(".lang-tab");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let selectedLanguage = "ko-KR";
let recognition = null;
let keepListening = false;
let finalOriginalSegments = [];
let finalKoreanSegments = [];
let interimOriginal = "";
let interimKorean = "";
let translationQueue = Promise.resolve();
let interimTimer = null;
let interimToken = 0;

function setStatusState(type) {
  statusPill.className = `status-pill ${type}`;
}

function updateStatus(message, type = "idle") {
  statusText.textContent = message;
  setStatusState(type);
}

function renderNotes(data) {
  const summary = data.summary || "요약 없음";
  const keyPoints = Array.isArray(data.keyPoints) && data.keyPoints.length > 0
    ? data.keyPoints.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
    : "없음";
  const actionItems = Array.isArray(data.actionItems) && data.actionItems.length > 0
    ? data.actionItems
        .map((item, idx) => {
          const owner = item.owner || "미정";
          const task = item.task || "내용 없음";
          const due = item.due || "미정";
          return `${idx + 1}. [${owner}] ${task} (기한: ${due})`;
        })
        .join("\n")
    : "없음";
  const risks = Array.isArray(data.risks) && data.risks.length > 0
    ? data.risks.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
    : "없음";
  const model = data.model ? `\n\n모델: ${data.model}` : "";

  return `요약\n${summary}\n\n핵심 포인트\n${keyPoints}\n\n액션 아이템\n${actionItems}\n\n리스크\n${risks}${model}`;
}

function renderTranscriptBoxes() {
  const originalText = [finalOriginalSegments.join(" "), interimOriginal]
    .filter(Boolean)
    .join(" ")
    .trim();
  transcriptOriginal.value = originalText;

  if (selectedLanguage === "ko-KR") {
    transcriptKorean.value = originalText;
    return;
  }

  const koreanText = [finalKoreanSegments.join(" "), interimKorean]
    .filter(Boolean)
    .join(" ")
    .trim();
  transcriptKorean.value = koreanText;
}

async function requestKoreanTranslation(text) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      sourceLanguageCode: selectedLanguage,
      targetLanguageCode: "ko-KR"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || "통역 실패");
  }
  return data.translatedText || "";
}

function queueFinalTranslation(segment) {
  if (!segment) return;
  if (selectedLanguage === "ko-KR") {
    finalKoreanSegments.push(segment);
    renderTranscriptBoxes();
    return;
  }

  translationQueue = translationQueue
    .then(async () => {
      const translated = await requestKoreanTranslation(segment);
      finalKoreanSegments.push(translated || segment);
      interimKorean = "";
      renderTranscriptBoxes();
    })
    .catch((_error) => {
      finalKoreanSegments.push(segment);
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
    try {
      const translated = await requestKoreanTranslation(currentInterim);
      if (token === interimToken) {
        interimKorean = translated;
        renderTranscriptBoxes();
      }
    } catch (_error) {
      if (token === interimToken) {
        interimKorean = "";
        renderTranscriptBoxes();
      }
    }
  }, 450);
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
    updateStatus(`전사 오류: ${event.error}`, "error");
  };

  instance.onend = () => {
    if (keepListening) {
      try {
        instance.start();
      } catch (_error) {
        updateStatus("전사 세션 재시작 실패", "error");
      }
    }
  };

  return instance;
}

function resetSession() {
  finalOriginalSegments = [];
  finalKoreanSegments = [];
  interimOriginal = "";
  interimKorean = "";
  translationQueue = Promise.resolve();
  interimToken += 1;
  clearTimeout(interimTimer);
  notesOutput.textContent = "아직 생성된 결과가 없습니다.";
  renderTranscriptBoxes();
}

languageTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    languageTabs.forEach((btn) => btn.classList.remove("active"));
    tab.classList.add("active");
    selectedLanguage = tab.dataset.lang || "ko-KR";
    updateStatus(`${tab.textContent.trim()} 모드 선택`, "idle");

    if (recognition) {
      recognition.lang = selectedLanguage;
    }
  });
});

startBtn.addEventListener("click", () => {
  if (!SpeechRecognition) {
    updateStatus("이 브라우저는 실시간 음성 전사를 지원하지 않습니다.", "error");
    return;
  }

  resetSession();
  if (!recognition) {
    recognition = setupRecognition();
  }
  recognition.lang = selectedLanguage;

  keepListening = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  updateStatus("실시간 전사/통역 진행 중...", "loading");

  try {
    recognition.start();
  } catch (_error) {
    updateStatus("녹음 시작에 실패했습니다. 브라우저 권한을 확인하세요.", "error");
    keepListening = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener("click", () => {
  keepListening = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateStatus("전사 종료", "idle");
  if (recognition) {
    recognition.stop();
  }
});

notesBtn.addEventListener("click", async () => {
  const transcript = transcriptOriginal.value.trim();
  if (!transcript) {
    updateStatus("먼저 전사를 진행해주세요.", "error");
    return;
  }

  try {
    notesBtn.disabled = true;
    updateStatus("회의 요약 생성 중...", "loading");

    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, languageCode: selectedLanguage })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.error || "회의 요약 실패");
    }

    notesOutput.textContent = renderNotes(data);
    updateStatus("회의 요약 완료", "success");
  } catch (error) {
    updateStatus(`회의 요약 실패: ${error.message}`, "error");
  } finally {
    notesBtn.disabled = false;
  }
});

pdfBtn.addEventListener("click", async () => {
  const content = notesOutput.textContent.trim();
  if (!content || content === "아직 생성된 결과가 없습니다.") {
    updateStatus("다운로드할 회의 요약이 없습니다.", "error");
    return;
  }

  try {
    pdfBtn.disabled = true;
    updateStatus("PDF 생성 중...", "loading");

    const wrapper = document.createElement("div");
    wrapper.style.padding = "18px";
    wrapper.style.fontFamily = "'Noto Sans KR', sans-serif";
    wrapper.style.fontSize = "13px";
    wrapper.style.lineHeight = "1.6";
    wrapper.style.whiteSpace = "pre-wrap";
    wrapper.style.wordBreak = "break-word";
    wrapper.textContent = content;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await window
      .html2pdf()
      .set({
        margin: 10,
        filename: `meeting-minutes-${timestamp}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      })
      .from(wrapper)
      .save();

    updateStatus("PDF 다운로드 완료", "success");
  } catch (error) {
    updateStatus(`PDF 생성 실패: ${error.message}`, "error");
  } finally {
    pdfBtn.disabled = false;
  }
});
