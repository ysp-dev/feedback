const STORAGE_KEY = "openai_api_key";
const API_BASE = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

// --- API Key ---
function loadKey() {
  const k = localStorage.getItem(STORAGE_KEY) || "";
  document.getElementById("api-key-input").value = k;
  updateKeyStatus(k);
  if (k) collapseApiSection();
}

function saveKey() {
  const raw = document.getElementById("api-key-input").value;
  const k = raw.replace(/[\s​‌‍﻿]/g, "");
  if (!k) return alert("API 키를 입력해주세요.");
  localStorage.setItem(STORAGE_KEY, k);
  testKey(k);
}

async function testKey(apiKey) {
  const statusEl = document.getElementById("key-status");
  statusEl.innerHTML = '<span style="color:#6b7280">확인 중...</span>';
  try {
    await fetch("https://api.openai.com", { mode: "no-cors" });
  } catch (e) {
    statusEl.innerHTML = '<span style="color:#ef4444">연결 불가 (네트워크/방화벽)</span>';
    return;
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      mode: "cors",
      credentials: "omit",
      headers: { "Authorization": "Bearer " + apiKey }
    });
    if (res.ok) {
      statusEl.innerHTML = '<span class="ok">저장됨 (' + apiKey.slice(0, 8) + '...) — 연결 OK</span>';
      collapseApiSection();
    } else {
      const data = await res.json();
      statusEl.innerHTML = '<span style="color:#ef4444">키 오류: ' + (data.error?.message || res.status) + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color:#ef4444">CORS 오류: ' + e.message + '</span>';
  }
}

function updateKeyStatus(k) {
  const el = document.getElementById("key-status");
  el.textContent = "";
  if (k) {
    const span = document.createElement("span");
    span.className = "ok";
    span.textContent = "저장됨 (" + k.slice(0, 8) + "...)";
    el.appendChild(span);
  }
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
      model: MODEL,
      messages: [{
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:" + mimeType + ";base64," + b64 }
          },
          {
            type: "text",
            text: "이 문서에서 텍스트를 정확히 추출해줘. 원본 형식(줄바꿈, 단락 구조)을 최대한 유지하고, 오직 추출된 텍스트만 반환해줘."
          }
        ]
      }],
      max_tokens: 4096
    };

    const text = await callOpenAI(apiKey, body);
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
      model: MODEL,
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

// --- OpenAI API ---
async function callOpenAI(apiKey, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    let res;
    try {
      res = await fetch(API_BASE, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      if (i < retries - 1) { await sleep(2000); continue; }
      throw new Error("네트워크 오류: OpenAI 서버에 연결할 수 없습니다. (" + netErr.message + ")");
    }
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
    throw new Error(data.error?.message || "OpenAI API 오류 (" + res.status + ")");
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
