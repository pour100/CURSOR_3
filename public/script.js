const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const uploadBtn = document.getElementById("uploadBtn");
const notesBtn = document.getElementById("notesBtn");
const audioFile = document.getElementById("audioFile");
const transcriptText = document.getElementById("transcriptText");
const notesOutput = document.getElementById("notesOutput");
const statusText = document.getElementById("status");
const statusPill = document.getElementById("statusPill");
const languageCode = document.getElementById("languageCode");

let mediaRecorder;
let chunks = [];
let recordedBlob = null;

function setStatus(message) {
  statusText.textContent = message;
}

function setStatusState(type) {
  statusPill.className = `status-pill ${type}`;
}

function updateStatus(message, type = "idle") {
  setStatus(message);
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

  const provider = data.model ? `\n\n모델: ${data.model}` : "";

  return `요약\n${summary}\n\n핵심 포인트\n${keyPoints}\n\n액션 아이템\n${actionItems}\n\n리스크\n${risks}${provider}`;
}

function lockTranscribeButtons(lock) {
  startBtn.disabled = lock || startBtn.disabled;
  stopBtn.disabled = lock || stopBtn.disabled;
  uploadBtn.disabled = lock;
}

async function transcribeBlob(blob, fileName = "recording.webm") {
  const formData = new FormData();
  formData.append("audio", blob, fileName);
  formData.append("languageCode", languageCode.value);

  updateStatus("전사 요청 중...", "loading");
  lockTranscribeButtons(true);
  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.error || "전사 실패");
    }

    transcriptText.value = data.transcript || "";
    if (data.warning) {
      updateStatus("전사 완료 (Google STT 이슈로 보조 엔진 사용)", "success");
    } else {
      updateStatus("전사 완료", "success");
    }
  } finally {
    lockTranscribeButtons(false);
  }
}

startBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recordedBlob = null;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: "audio/webm" });
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    updateStatus("녹음 중...", "loading");
  } catch (error) {
    updateStatus(`녹음 시작 실패: ${error.message}`, "error");
  }
});

stopBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;

  mediaRecorder.stop();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateStatus("녹음 종료. 전사 중...", "loading");

  setTimeout(async () => {
    if (!recordedBlob) {
      updateStatus("녹음 데이터가 없습니다.", "error");
      return;
    }
    try {
      await transcribeBlob(recordedBlob);
    } catch (error) {
      updateStatus(`전사 실패: ${error.message}`, "error");
    }
  }, 250);
});

uploadBtn.addEventListener("click", async () => {
  const file = audioFile.files?.[0];
  if (!file) {
    updateStatus("업로드할 오디오 파일을 선택해주세요.", "error");
    return;
  }

  try {
    await transcribeBlob(file, file.name);
  } catch (error) {
    updateStatus(`전사 실패: ${error.message}`, "error");
  }
});

notesBtn.addEventListener("click", async () => {
  const transcript = transcriptText.value.trim();
  if (!transcript) {
    updateStatus("먼저 전사를 완료해주세요.", "error");
    return;
  }

  try {
    notesBtn.disabled = true;
    updateStatus("회의 요약 생성 중...", "loading");
    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, languageCode: languageCode.value })
    });
    const data = await response.json();
    notesBtn.disabled = false;
    if (!response.ok) {
      throw new Error(data.detail || data.error || "회의 요약 실패");
    }

    notesOutput.textContent = renderNotes(data);
    updateStatus("회의 요약 완료", "success");
  } catch (error) {
    notesBtn.disabled = false;
    updateStatus(`회의 요약 실패: ${error.message}`, "error");
  }
});
