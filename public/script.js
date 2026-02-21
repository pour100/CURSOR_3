const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const uploadBtn = document.getElementById("uploadBtn");
const notesBtn = document.getElementById("notesBtn");
const audioFile = document.getElementById("audioFile");
const transcriptText = document.getElementById("transcriptText");
const notesOutput = document.getElementById("notesOutput");
const statusText = document.getElementById("status");
const languageCode = document.getElementById("languageCode");

let mediaRecorder;
let chunks = [];
let recordedBlob = null;

function setStatus(message) {
  statusText.textContent = message;
}

async function transcribeBlob(blob, fileName = "recording.webm") {
  const formData = new FormData();
  formData.append("audio", blob, fileName);
  formData.append("languageCode", languageCode.value);

  setStatus("전사 요청 중...");
  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "전사 실패");
  }

  transcriptText.value = data.transcript || "";
  setStatus("전사 완료");
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
    setStatus("녹음 중...");
  } catch (error) {
    setStatus(`녹음 시작 실패: ${error.message}`);
  }
});

stopBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;

  mediaRecorder.stop();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("녹음 종료. 전사 중...");

  setTimeout(async () => {
    if (!recordedBlob) {
      setStatus("녹음 데이터가 없습니다.");
      return;
    }
    try {
      await transcribeBlob(recordedBlob);
    } catch (error) {
      setStatus(`전사 실패: ${error.message}`);
    }
  }, 250);
});

uploadBtn.addEventListener("click", async () => {
  const file = audioFile.files?.[0];
  if (!file) {
    setStatus("업로드할 오디오 파일을 선택해주세요.");
    return;
  }

  try {
    await transcribeBlob(file, file.name);
  } catch (error) {
    setStatus(`전사 실패: ${error.message}`);
  }
});

notesBtn.addEventListener("click", async () => {
  const transcript = transcriptText.value.trim();
  if (!transcript) {
    setStatus("먼저 전사를 완료해주세요.");
    return;
  }

  try {
    setStatus("회의 요약 생성 중...");
    const response = await fetch("/api/meeting-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "회의 요약 실패");
    }

    notesOutput.textContent = JSON.stringify(data, null, 2);
    setStatus("회의 요약 완료");
  } catch (error) {
    setStatus(`회의 요약 실패: ${error.message}`);
  }
});
