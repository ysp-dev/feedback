const STORAGE_KEY = "gemini_api_key";
const MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";

// --- API Key ---
function loadKey() {
  const k = localStorage.getItem(STORAGE_KEY) || "";
  document.getElementById("api-key-input").value = k;
  updateKeyStatus(k);
  if (k) collapseApiSection();
}

function saveKey() {
  const k = document.getElementById("api-key-input").value.trim();
  if (!k) return alert("API 키를 입력해주세요.");
  localStorage.setItem(STORAGE_KEY, k);
  updateKeyStatus(k);
  collapseApiSection();
}

function updateKeyStatus(k) {
  const el = document.getElementById("key-status");
  el.innerHTML = k ? '<span class="ok">저장됨 (' + k.slice(0, 8) + "...)</span>" : "";
}

function toggleKey() {
  const el = document.getElementById("api-key-input");
  el.type = el.type === "password" ? "text" : "password";
}

function getKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

// --- Image ---
let selectedFile = null;
let cropper = null;

function handleFile(file) {
  if (!file) return;
  openCropModal(file);
}

// --- Crop ---
function openCropModal(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById("crop-img");
    img.src = e.target.result;
    document.getElementById("crop-modal").classList.remove("d-none");
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 0.85,
      highlight: false,
    });
  };
  reader.readAsDataURL(file);
}

function applyCrop() {
  if (!cropper) return;
  cropper.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048 })
    .toBlob(blob => {
      selectedFile = new File([blob], "cropped.jpg", { type: "image/jpeg" });
      const img = document.getElementById("preview-img");
      img.src = URL.createObjectURL(blob);
      img.style.display = "block";
      document.getElementById("ocr-btn").disabled = false;
      closeCropModal();
    }, "image/jpeg", 0.92);
}

function rotateCrop(deg) {
  if (cropper) cropper.rotate(deg);
}

function cancelCrop() {
  closeCropModal();
}

function closeCropModal() {
  document.getElementById("crop-modal").classList.add("d-none");
  if (cropper) { cropper.destroy(); cropper = null; }
}

document.getElementById("camera-input").addEventListener("change", e => handleFile(e.target.files[0]));
document.getElementById("file-input").addEventListener("change", e => handleFile(e.target.files[0]));

// --- OCR ---
async function runOcr() {
  const apiKey = getKey();
  if (!apiKey) return alert("API 키를 먼저 저장해주세요.");
  if (!selectedFile) return;

  setLoading("ocr", true);
  document.getElementById("ocr-error").classList.add("d-none");
  document.getElementById("ocr-text").value = "";
  document.getElementById("reply-btn").disabled = true;

  try {
    const b64 = await toBase64(selectedFile);
    const mimeType = selectedFile.type || "image/jpeg";

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: b64 } },
          { text: "이 문서에서 텍스트를 정확히 추출해줘. 원본 형식(줄바꿈, 단락 구조)을 최대한 유지하고, 오직 추출된 텍스트만 반환해줘." }
        ]
      }]
    };

    const text = await callGemini(apiKey, body);
    document.getElementById("ocr-text").value = text;
    document.getElementById("reply-btn").disabled = false;
  } catch (e) {
    showError("ocr-error", e.message);
  } finally {
    setLoading("ocr", false);
  }
}

// --- Reply ---
async function runReply() {
  const apiKey = getKey();
  if (!apiKey) return alert("API 키를 먼저 저장해주세요.");

  const feedbackText = document.getElementById("ocr-text").value.trim();
  if (!feedbackText) return;

  setLoading("reply", true);
  document.getElementById("reply-error").classList.add("d-none");
  document.getElementById("reply-text").value = "";

  try {
    const body = {
      system_instruction: {
        parts: [{ text:
          "당신은 전문적인 비즈니스 커뮤니케이션 전문가입니다. " +
          "피드백을 주신 한 분께 드리는 답변 메시지를 작성합니다. " +
          "메일 형식(수신자, 제목, 서명 등)이 아닌 자연스러운 답변글 형식으로 작성합니다."
        }]
      },
      contents: [{
        parts: [{ text:
          "다음은 경영진 한 분이 주신 피드백입니다. 이 분께 드릴 정중하고 전문적인 답변글을 작성해주세요:\n\n" +
          feedbackText + "\n\n" +
          "작성 조건:\n" +
          "- 메일 형식(수신자, 제목, 발신자 서명 등) 없이 답변 본문만 작성\n" +
          "- 피드백 주신 분 한 분께 직접 드리는 말투\n" +
          "- 감사함을 표현하고, 피드백 핵심에 직접 응답하며, 향후 개선 의지 포함\n" +
          "- 답변 길이는 피드백 텍스트(" + feedbackText.length + "자)와 비슷한 수준"
        }]
      }]
    };

    const text = await callGemini(apiKey, body);
    document.getElementById("reply-text").value = text;
  } catch (e) {
    showError("reply-error", e.message);
  } finally {
    setLoading("reply", false);
  }
}

// --- Gemini API (재시도 포함) ---
async function callGemini(apiKey, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${API_BASE}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return data.candidates[0].content.parts[0].text;
    if (res.status === 503 && i < retries - 1) {
      await sleep(3000);
      continue;
    }
    throw new Error(data.error?.message || "API 오류가 발생했습니다.");
  }
}

// --- Utils ---
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setLoading(type, on) {
  document.getElementById(type + "-btn").disabled = on;
  document.getElementById(type + "-spinner").classList.toggle("d-none", !on);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("d-none");
}

async function copyReply() {
  const text = document.getElementById("reply-text").value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById("copy-btn");
  btn.textContent = "✓ 복사 완료!";
  btn.classList.add("copied");
  setTimeout(() => { btn.textContent = "클립보드 복사"; btn.classList.remove("copied"); }, 2000);
}

// --- Reset ---
function resetAll() {
  selectedFile = null;
  document.getElementById("camera-input").value = "";
  document.getElementById("file-input").value = "";
  document.getElementById("preview-img").style.display = "none";
  document.getElementById("ocr-btn").disabled = true;
  document.getElementById("ocr-text").value = "";
  document.getElementById("ocr-error").classList.add("d-none");
  document.getElementById("reply-btn").disabled = true;
  document.getElementById("reply-text").value = "";
  document.getElementById("reply-error").classList.add("d-none");
}

// --- API Section toggle ---
function collapseApiSection() {
  document.getElementById("api-input-wrap").classList.add("d-none");
  document.getElementById("api-chevron").textContent = "+";
}

function expandApiSection() {
  document.getElementById("api-input-wrap").classList.remove("d-none");
  document.getElementById("api-chevron").textContent = "−";
}

function toggleApiSection() {
  const wrap = document.getElementById("api-input-wrap");
  wrap.classList.contains("d-none") ? expandApiSection() : collapseApiSection();
}

// init
loadKey();
