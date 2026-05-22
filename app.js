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

// --- Classification ---
const CLASSIFY_DATA = {
  "Top-down": {
    types: [
      { id: "recognizing", label: "인정·칭찬형",     desc: "잘한 것을 명확히 짚어 동기를 강화한다",       subtypes: ["성과 인정", "행동 칭찬", "성장 인정"] },
      { id: "directing",   label: "방향제시형",       desc: "다음에 무엇을 어떻게 해야 할지 알려준다",     subtypes: ["행동 제안", "우선순위 정렬", "기준 제시"] },
      { id: "developing",  label: "성장촉진형",       desc: "경험을 역량으로 전환하도록 자극한다",         subtypes: ["경험 의미화", "자산화 유도", "시야 확장"] },
      { id: "correcting",  label: "교정·개선형",      desc: "잘못된 방향이나 습관을 바로잡는다",           subtypes: ["행동 교정", "인식 교정", "재발 방지"] },
      { id: "supporting",  label: "지지·배려형",      desc: "업무 너머 사람에게 관심을 전한다",            subtypes: ["과부하 인지", "심리적 안전", "관계 유지"] },
      { id: "aligning",    label: "정렬·공유형",      desc: "팀 전체 방향과 개인 업무를 연결한다",         subtypes: ["맥락 공유", "기대 명확화", "팀 연결"] }
    ]
  },
  "Bottom-up": {
    types: [
      { id: "informing",   label: "정보 제공형",      desc: "경영진이 모르는 현장 실태를 알린다",          subtypes: ["현황 보고", "조기 경보", "현장 체감 공유"] },
      { id: "proposing",   label: "건의·제안형",      desc: "더 나은 방향을 위에 제안한다",                subtypes: ["자원 요청", "프로세스 개선 제안", "우선순위 조정 건의"] },
      { id: "alerting",    label: "리스크 경고형",    desc: "의사결정권자가 알아야 할 위험을 공식화한다",  subtypes: ["기술적 리스크", "일정 리스크", "조직·역량 리스크"] },
      { id: "reporting",   label: "실행 결과 보고형", desc: "지시·결정에 대한 피드백 루프를 완성한다",    subtypes: ["완료 보고", "효과 검증", "예외 사항 보고"] },
      { id: "advocating",  label: "의견 개진형",      desc: "경영 판단에 현장 시각을 반영시킨다",          subtypes: ["반론·이견 제시", "우선순위 이견", "팀원 옹호"] }
    ]
  }
};

const SUBTYPE_PROMPT = {
  recognizing: { "성과 인정": "완료된 결과물·목표 달성을 명확히 공식화하며 인정", "행동 칭찬": "결과보다 과정·태도·자세에 초점을 맞춰 칭찬", "성장 인정": "이전 대비 발전한 점을 구체적으로 언급하며 격려" },
  directing:   { "행동 제안": "구체적인 넥스트 액션을 명확히 제시", "우선순위 정렬": "여러 업무 중 집중할 포인트를 우선순위와 함께 안내", "기준 제시": "판단의 기준과 원칙을 명확히 전달" },
  developing:  { "경험 의미화": "지금 하는 일의 성장 가치와 의미를 짚어줌", "자산화 유도": "경험을 기록·정리해 재활용하도록 구체적으로 유도", "시야 확장": "현재 업무 너머의 큰 그림을 보게 하는 관점 제시" },
  correcting:  { "행동 교정": "특정 행동·방식의 변화를 명확하되 배려 있게 요청", "인식 교정": "잘못된 판단 기준이나 관점을 바로잡는 메시지", "재발 방지": "같은 실수 반복을 막는 구체적인 루틴·방법 제안" },
  supporting:  { "과부하 인지": "힘든 상황을 부서장이 인식하고 있음을 따뜻하게 전달", "심리적 안전": "실패·이견을 말해도 괜찮다는 심리적 안전 신호 전달", "관계 유지": "평가와 무관한 인간적 관심과 안부 표현" },
  aligning:    { "맥락 공유": "개인 업무가 전체 프로젝트에서 왜 중요한지 설명", "기대 명확화": "부서장이 기대하는 바를 명확하고 구체적으로 전달", "팀 연결": "개인 업무가 팀·조직에 기여함을 인식시키는 메시지" },
  informing:   { "현황 보고": "진행 상태와 리스크를 객관적·사실적으로 전달", "조기 경보": "문제가 커지기 전 선제적으로 이슈를 알리는 형식", "현장 체감 공유": "숫자로 표현되지 않는 팀의 실제 부하·분위기를 전달" },
  proposing:   { "자원 요청": "인력·예산·일정 조정 필요성과 근거를 명확히 건의", "프로세스 개선 제안": "비효율 발견 내용과 구체적 개선안을 제안", "우선순위 조정 건의": "현장 관점에서 순서·범위 재검토를 건의" },
  alerting:    { "기술적 리스크": "장애·이슈의 파급 가능성을 구체적으로 경고", "일정 리스크": "지연 가능성과 임계점을 사전에 공식 보고", "조직·역량 리스크": "핵심 인력 과부하·이탈 위험을 공식화" },
  reporting:   { "완료 보고": "지시사항 실행 결과를 명확하고 간결하게 전달", "효과 검증": "의사결정의 실제 효과를 수치와 함께 전달", "예외 사항 보고": "계획 대비 달라진 점과 이유를 명확히 보고" },
  advocating:  { "반론·이견 제시": "경영 방향과 다른 현장 판단을 정중하되 명확하게 공식화", "우선순위 이견": "경영진 관심 밖 항목의 중요성을 근거와 함께 강조", "팀원 옹호": "팀원의 성과·처우를 부서장이 대신 경영진에 전달" }
};

const clsState = { direction: null, type: null, subtype: null, intensity: null, timing: null };

function selectChip(el, group) {
  el.closest('.classify-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  clsState[group] = el.dataset.value;
  if (group === 'direction') onDirectionChange(el.dataset.value);
  else if (group === 'type') onTypeChange(el.dataset.value);
}

function onDirectionChange(direction) {
  const types = CLASSIFY_DATA[direction].types;
  clsState.type = null;
  clsState.subtype = null;
  document.getElementById('type-chips').innerHTML = types.map(t =>
    `<button class="chip" data-value="${t.id}" onclick="selectChip(this,'type')">${t.label}</button>`
  ).join('');
  document.getElementById('type-desc').textContent = '';
  document.getElementById('type-group').classList.remove('d-none');
  document.getElementById('subtype-group').classList.add('d-none');
}

function onTypeChange(typeId) {
  const types = CLASSIFY_DATA[clsState.direction].types;
  const typeData = types.find(t => t.id === typeId);
  if (!typeData) return;
  clsState.subtype = null;
  document.getElementById('type-desc').textContent = typeData.desc;
  document.getElementById('subtype-chips').innerHTML = typeData.subtypes.map(s =>
    `<button class="chip" data-value="${s}" onclick="selectChip(this,'subtype')">${s}</button>`
  ).join('');
  document.getElementById('subtype-group').classList.remove('d-none');
}

function buildPromptFromClassification() {
  const cls = clsState;
  const direction = cls.direction;
  const dirData = direction ? CLASSIFY_DATA[direction] : null;
  const typeData = (dirData && cls.type) ? dirData.types.find(t => t.id === cls.type) : null;
  const intensity = cls.intensity || "정식";
  const timing = cls.timing;

  const sysLines = [];
  if (direction === "Top-down") {
    sysLines.push("당신은 IT 프로젝트를 총괄하는 부서장입니다. 팀원이 제출한 내용을 읽고 코칭 피드백 메시지를 작성합니다.");
  } else if (direction === "Bottom-up") {
    sysLines.push("당신은 IT 프로젝트를 총괄하는 부서장입니다. 현장 내용을 바탕으로 경영진에게 전달할 메시지를 작성합니다.");
  } else {
    sysLines.push("당신은 기업 비즈니스 커뮤니케이션 전문가입니다. 피드백에 대한 격식체 답변을 작성합니다.");
  }
  if (intensity === "라이트" && timing === "즉시") {
    sysLines.push("메신저 톤으로 짧고 가볍게, 이모지 1–2개 사용 가능합니다.");
  } else if (intensity === "정식" && timing === "공식") {
    sysLines.push("공식 문서 수준의 완결된 격식체로 작성합니다.");
  } else if (intensity === "라이트") {
    sysLines.push("친근하되 전문적인 어투로 간결하게 작성합니다.");
  } else {
    sysLines.push("전문적이고 격식 있는 어투로 작성합니다.");
  }
  sysLines.push("메일 서식(수신자·제목·서명) 없이 본문만 작성합니다.");

  const conditions = [];
  if (direction === "Top-down") {
    conditions.push("팀원에게 보내는 부서장의 어투 (격식체, 배려 있는 어조)");
  } else if (direction === "Bottom-up") {
    conditions.push("경영진에게 보고하는 부서장의 어투 (격식체, 명확하고 간결한 보고 문체)");
  } else {
    conditions.push("격식체 존댓말, 전문적이고 정중한 어조");
    conditions.push("구성: 감사 표현 → 피드백 핵심 수용 및 직접 응답 → 구체적 개선·실행 의지");
  }
  if (typeData) {
    const subtypeHint = (cls.subtype && SUBTYPE_PROMPT[cls.type]) ? SUBTYPE_PROMPT[cls.type][cls.subtype] : null;
    conditions.push(subtypeHint || typeData.desc);
  }
  if (intensity === "라이트" && timing === "즉시") {
    conditions.push("3–5문장 이내, 메신저 톤");
  } else if (intensity === "라이트" && timing === "정기") {
    conditions.push("핵심만 담아 7문장 이내");
  } else if (intensity === "라이트" && timing === "공식") {
    conditions.push("간결하고 임팩트 있는 메시지");
  } else if (intensity === "정식" && timing === "즉시") {
    conditions.push("격식 있되 간결하게");
  } else if (intensity === "정식" && timing === "정기") {
    conditions.push("구조적으로 정리된 형식 (상황 → 핵심 → 의지·제안)");
  } else if (intensity === "정식" && timing === "공식") {
    conditions.push("공식 문서 수준의 완결된 서술");
  } else {
    conditions.push("불필요한 반복·수식어 없이 간결하게 (입력 길이의 1~1.5배 이내)");
  }

  const introText = direction === "Top-down"
    ? "다음 팀원 보고 내용을 바탕으로 코칭 메시지를 작성해주세요:"
    : direction === "Bottom-up"
    ? "다음 내용을 바탕으로 경영진에게 전달할 메시지를 작성해주세요:"
    : "다음 피드백에 대한 답변을 작성해주세요:";

  return { systemText: sysLines.join(" "), conditionText: conditions.map(c => `- ${c}`).join("\n"), introText };
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
    const { systemText, conditionText, introText } = buildPromptFromClassification();
    const body = {
      system_instruction: {
        parts: [{ text: systemText }]
      },
      contents: [{
        parts: [{ text:
          introText + "\n\n" +
          feedbackText + "\n\n" +
          "작성 조건:\n" +
          conditionText +
          "\n- 본문만 작성 (메일 서식 없음)"
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
    if (statusEl) statusEl.textContent = model + " 시도 중...";

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
      if (i < MODELS.length - 1) await new Promise(r => setTimeout(r, 500));
      continue;
    }

    throw new Error(rawMsg || "API 오류가 발생했습니다.");
  }

  if (lastError?.limitType === "rpd") {
    throw new Error("일일 API 한도 초과. 내일 다시 시도하세요.");
  }
  if (lastError?.status === 429) {
    throw new Error(`모든 모델(${MODELS.length}개) 한도 초과. 잠시 후 다시 시도해주세요.`);
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
  Object.keys(clsState).forEach(k => clsState[k] = null);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('type-group').classList.add('d-none');
  document.getElementById('subtype-group').classList.add('d-none');
  document.getElementById('type-desc').textContent = '';
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
