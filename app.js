const STORAGE_KEY = "gemini_api_key";
const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

function getApiBase(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
}

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
  testKey(k);
}

async function testKey(apiKey) {
  const el = document.getElementById("key-status");
  el.innerHTML = '<span class="status-dot dot-gray"></span>';
  try {
    const res = await fetch(getApiBase(MODELS[0]), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
    });
    if (res.ok) {
      el.innerHTML = '<span class="status-dot dot-green"></span>';
      collapseApiSection();
    } else {
      el.innerHTML = '<span class="status-dot dot-red"></span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="status-dot dot-red"></span>';
  }
}

function updateKeyStatus(k) {
  const el = document.getElementById("key-status");
  el.innerHTML = k ? '<span class="status-dot dot-green"></span>' : "";
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
  cropper.getCroppedCanvas({ maxWidth: 1400, maxHeight: 1400 })
    .toBlob(blob => {
      selectedFile = new File([blob], "cropped.jpg", { type: "image/jpeg" });
      const img = document.getElementById("preview-img");
      img.src = URL.createObjectURL(blob);
      img.style.display = "block";
      document.getElementById("ocr-btn").disabled = false;
      closeCropModal();
    }, "image/jpeg", 0.82);
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
document.getElementById("ocr-text").addEventListener("input", () => {
  document.getElementById("reply-btn").disabled = !document.getElementById("ocr-text").value.trim();
});

// --- OCR ---
async function runOcr() {
  const apiKey = getKey();
  if (!apiKey) return alert("API 키를 먼저 저장해주세요.");
  if (!selectedFile) return;

  setLoading("ocr", true);
  setOcrStatus("이미지 분석 중...");
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

    setOcrStatus("텍스트 추출 중...");
    const text = await callGemini(apiKey, body, document.querySelector(".ocr-label"));
    document.getElementById("ocr-text").value = text;
    document.getElementById("reply-btn").disabled = false;
    setOcrStatus("");
  } catch (e) {
    showError("ocr-error", e.message);
    setOcrStatus("");
  } finally {
    setLoading("ocr", false);
  }
}

function setOcrStatus(msg) {
  const btn = document.getElementById("ocr-btn");
  btn.dataset.label = btn.dataset.label || "OCR 분석";
  const spinner = document.getElementById("ocr-spinner");
  const labelEl = btn.querySelector(".ocr-label");
  if (labelEl) labelEl.textContent = msg || "OCR 분석";
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
          "당신은 기업 비즈니스 커뮤니케이션 전문가입니다. " +
          "경영진이 주신 피드백에 대한 격식체 답변을 작성합니다. " +
          "전문적이고 정중하며 격식을 갖추되 군더더기 없이 간결하게, " +
          "메일 서식(수신자·제목·서명) 없이 본문만 작성합니다."
        }]
      },
      contents: [{
        parts: [{ text:
          "다음 피드백에 대한 답변을 작성해주세요:\n\n" +
          feedbackText + "\n\n" +
          "작성 조건:\n" +
          "- 격식체 존댓말, 전문적이고 정중한 어조\n" +
          "- 구성: 감사 표현 → 피드백 핵심 수용 및 직접 응답 → 구체적 개선·실행 의지\n" +
          "- 불필요한 반복·수식어 없이 간결하게 (피드백 길이의 1~1.5배 이내)\n" +
          "- 본문만 작성 (메일 서식 없음)"
        }]
      }]
    };

    const text = await callGemini(apiKey, body, document.querySelector(".reply-label"));
    document.getElementById("reply-text").value = text;
  } catch (e) {
    showError("reply-error", e.message);
  } finally {
    setLoading("reply", false);
    const labelEl = document.querySelector(".reply-label");
    if (labelEl) labelEl.textContent = "답변 생성";
  }
}

// --- Gemini API ---
function detectRateLimitType(rawMsg) {
  const n = rawMsg.toLowerCase();
  if (n.includes("per day") || n.includes("per_day") || n.includes("daily")) return "rpd";
  return "rpm";
}

async function callGemini(apiKey, body, statusEl) {
  let lastError = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    if (statusEl && i > 0) statusEl.textContent = model + " 시도 중...";

    let res, data;
    try {
      res = await fetch(getApiBase(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      data = await res.json();
    } catch (e) {
      throw new Error("네트워크 연결을 확인하세요.");
    }

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

    const rawMsg = data.error?.message || "";

    if (res.status === 429 || res.status === 503) {
      const limitType = res.status === 429 ? detectRateLimitType(rawMsg) : null;
      const err = new Error(rawMsg || (res.status === 429 ? "요청 한도 초과" : "서버 오류"));
      err.status = res.status;
      err.limitType = limitType;
      lastError = err;
      continue; // RPD·RPM 구분 없이 항상 다음 모델로
    }

    throw new Error(rawMsg || "API 오류가 발생했습니다.");
  }

  if (lastError?.limitType === "rpd") {
    throw new Error("일일 API 한도 초과. 내일 다시 시도하세요.");
  }
  throw lastError || new Error("모든 모델에서 오류가 발생했습니다.");
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

// --- Pull to refresh ---
(function () {
  const THRESHOLD = 70;
  const indicator = document.getElementById("ptr-indicator");
  let startY = 0;
  let maxDelta = 0;
  let active = false;

  function atTop() {
    return (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) === 0;
  }

  function reset(trigger) {
    indicator.style.transform = "translateX(-50%) translateY(-60px)";
    indicator.style.opacity = 0;
    indicator.classList.remove("ptr-ready");
    active = false;
    if (trigger) resetAll();
  }

  document.addEventListener("touchstart", e => {
    if (!atTop()) return;
    startY = e.touches[0].clientY;
    maxDelta = 0;
    active = true;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!active) return;
    const delta = Math.max(0, e.touches[0].clientY - startY);
    maxDelta = Math.max(maxDelta, delta);
    const progress = Math.min(delta / THRESHOLD, 1);
    indicator.style.transform = `translateX(-50%) translateY(${(progress - 1) * 60}px)`;
    indicator.style.opacity = progress;
    indicator.classList.toggle("ptr-ready", delta >= THRESHOLD);
  }, { passive: true });

  document.addEventListener("touchend", () => reset(active && maxDelta >= THRESHOLD));
  document.addEventListener("touchcancel", () => reset(false));
})();

// init
loadKey();
