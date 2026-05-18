const GEMINI_STORAGE_KEY = "gemini_api_key";
const OPENAI_STORAGE_KEY = "openai_api_key";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent";
const OPENAI_API_BASE = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

// --- API Key ---
function loadKey() {
  const gemini = localStorage.getItem(GEMINI_STORAGE_KEY) || "";
  const openai = localStorage.getItem(OPENAI_STORAGE_KEY) || "";
  document.getElementById("gemini-key-input").value = gemini;
  document.getElementById("openai-key-input").value = openai;
  updateKeyStatus("gemini-key-status", gemini);
  updateKeyStatus("openai-key-status", openai);
  if (gemini && openai) collapseApiSection();
}

function saveKey(type) {
  const inputId = type + "-key-input";
  const storageKey = type === "gemini" ? GEMINI_STORAGE_KEY : OPENAI_STORAGE_KEY;
  const k = document.getElementById(inputId).value.trim();
  if (!k) return alert("API 키를 입력해주세요.");
  localStorage.setItem(storageKey, k);
  updateKeyStatus(type + "-key-status", k);
}

function updateKeyStatus(statusId, k) {
  const el = document.getElementById(statusId);
  el.textContent = "";
  if (k) {
    const span = document.createElement("span");
    span.className = "ok";
    span.textContent = "저장됨 (" + k.slice(0, 8) + "...)";
    el.appendChild(span);
  }
}

function toggleKey(type) {
  const el = document.getElementById(type + "-key-input");
  el.type = el.type === "password" ? "text" : "password";
}

function getGeminiKey() {
  return localStorage.getItem(GEMINI_STORAGE_KEY) || "";
}

function getOpenAIKey() {
  return localStorage.getItem(OPENAI_STORAGE_KEY) || "";
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
  document.getElementById("camera-input").value = "";
  document.getElementById("file-input").value = "";
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
  const apiKey = getGeminiKey();
  if (!apiKey) return alert("Gemini API 키를 먼저 저장해주세요.");
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
    document.getElementById("reply-btn").disabled = !getOpenAIKey();
  } catch (e) {
    showError("ocr-error", e.message);
  } finally {
    setLoading("ocr", false);
  }
}

// --- Reply ---
async function runReply() {
  const apiKey = getOpenAIKey();
  if (!apiKey) return alert("OpenAI API 키를 먼저 저장해주세요.");

  const feedbackText = document.getElementById("ocr-text").value.trim();
  if (!feedbackText) return;

  setLoading("reply", true);
  document.getElementById("reply-error").classList.add("d-none");
  document.getElementById("reply-text").value = "";

  try {
    const body = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "당신은 전문적인 비즈니스 커뮤니케이션 전문가입니다. " +
            "피드백을 주신 한 분께 드리는 답변 메시지를 작성합니다. " +
            "메일 형식(수신자, 제목, 서명 등)이 아닌 자연스러운 답변글 형식으로 작성합니다."
        },
        {
          role: "user",
          content:
            "다음은 경영진 한 분이 주신 피드백입니다. 이 분께 드릴 정중하고 전문적인 답변글을 작성해주세요:\n\n" +
            feedbackText + "\n\n" +
            "작성 조건:\n" +
            "- 메일 형식(수신자, 제목, 발신자 서명 등) 없이 답변 본문만 작성\n" +
            "- 피드백 주신 분 한 분께 직접 드리는 말투\n" +
            "- 감사함을 표현하고, 피드백 핵심에 직접 응답하며, 향후 개선 의지 포함\n" +
            "- 답변 길이는 피드백 텍스트(" + feedbackText.length + "자)와 비슷한 수준"
        }
      ]
    };

    const text = await callOpenAI(apiKey, body);
    document.getElementById("reply-text").value = text;
  } catch (e) {
    showError("reply-error", e.message);
  } finally {
    setLoading("reply", false);
  }
}

// --- Gemini API (OCR용, 재시도 포함) ---
async function callGemini(apiKey, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(GEMINI_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const candidate = data.candidates?.[0];
      if (!candidate) {
        const blockReason = data.promptFeedback?.blockReason;
        throw new Error(blockReason
          ? "요청이 차단되었습니다: " + blockReason
          : "응답에 후보가 없습니다.");
      }
      const { finishReason } = candidate;
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        throw new Error("생성이 중단되었습니다: " + finishReason);
      }
      const text = candidate.content?.parts?.[0]?.text;
      if (!text) throw new Error("응답에서 텍스트를 찾을 수 없습니다.");
      return text;
    }
    if (res.status === 503 && i < retries - 1) {
      await sleep(3000);
      continue;
    }
    throw new Error(data.error?.message || "API 오류가 발생했습니다.");
  }
}

// --- OpenAI API (답변 생성용) ---
async function callOpenAI(apiKey, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(OPENAI_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("응답에서 텍스트를 찾을 수 없습니다.");
      return text;
    }
    if (res.status === 503 && i < retries - 1) {
      await sleep(3000);
      continue;
    }
    throw new Error(data.error?.message || "OpenAI API 오류가 발생했습니다.");
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
  const btn = document.getElementById("copy-btn");

  const markSuccess = () => {
    btn.textContent = "✓ 복사 완료!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "클립보드 복사"; btn.classList.remove("copied"); }, 2000);
  };

  try {
    await navigator.clipboard.writeText(text);
    markSuccess();
  } catch {
    // clipboard API 미지원 환경 fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) {
      markSuccess();
    } else {
      btn.textContent = "복사 실패 — 직접 선택하세요";
      setTimeout(() => { btn.textContent = "클립보드 복사"; }, 3000);
    }
  }
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

// --- file:// 경고 ---
function checkProtocol() {
  if (location.protocol === "file:") {
    const banner = document.getElementById("file-protocol-banner");
    if (banner) banner.classList.remove("d-none");
  }
}

// init
loadKey();
checkProtocol();
