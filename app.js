const STORAGE_KEY = "openai_api_key";
const MODEL = "gpt-5.5";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

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
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }], max_tokens: 5 })
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
      if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      img.alt = "크롭된 미리보기";
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
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + b64 } },
          { type: "text", text: "이 문서에서 텍스트를 정확히 추출해줘. 원본 형식(줄바꿈, 단락 구조)을 최대한 유지하고, 오직 추출된 텍스트만 반환해줘." }
        ]
      }]
    };

    setOcrStatus("텍스트 추출 중...");
    const text = await callOpenAI(apiKey, body, document.querySelector(".ocr-label"));
    document.getElementById("ocr-text").value = text;
    document.getElementById("reply-btn").disabled = false;
  } catch (e) {
    showError("ocr-error", e.message);
  } finally {
    setLoading("ocr", false);
    setOcrStatus("");
  }
}

function setOcrStatus(msg) {
  const labelEl = document.getElementById("ocr-btn").querySelector(".ocr-label");
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
      { id: "aligning",    label: "정렬·공유형",      desc: "팀 전체 방향과 개인 업무를 연결한다",         subtypes: ["맥락 공유", "기대 명확화", "팀 연결"] },
      { id: "delegating",  label: "위임·자율형",      desc: "역량을 인정하며 결정 권한을 명시적으로 이양한다", subtypes: ["권한 이양", "자율적 실행 요청", "자기결정 지지"] }
    ]
  },
  "Bottom-up": {
    types: [
      { id: "informing",   label: "정보 제공형",      desc: "경영진이 모르는 현장 실태를 알린다",          subtypes: ["현황 보고", "조기 경보", "현장 체감 공유"] },
      { id: "proposing",   label: "건의·제안형",      desc: "더 나은 방향을 위에 제안한다",                subtypes: ["자원 요청", "프로세스 개선 제안", "우선순위 조정 건의"] },
      { id: "alerting",    label: "리스크 경고형",    desc: "의사결정권자가 알아야 할 위험을 공식화한다",  subtypes: ["기술적 리스크", "일정 리스크", "조직·역량 리스크"] },
      { id: "reporting",   label: "실행 결과 보고형", desc: "지시·결정에 대한 피드백 루프를 완성한다",    subtypes: ["완료 보고", "효과 검증", "예외 사항 보고"] },
      { id: "advocating",  label: "의견 개진형",      desc: "경영 판단에 현장 시각을 반영시킨다",          subtypes: ["반론·이견 제시", "우선순위 이견", "팀원 옹호"] },
      { id: "requesting",  label: "승인 요청형",      desc: "경영진의 공식 결정을 요청하고 근거를 제시한다", subtypes: ["의사결정 요청", "자원 배정 승인", "우선순위 확정 요청"] }
    ]
  }
};

const SUBTYPE_PROMPT = {
  recognizing: { "성과 인정": "완료된 결과물·목표 달성을 공식화하며 인정 → 구체적 성과 언급 → 조직 기여 연결", "행동 칭찬": "결과보다 과정·태도·자세에 초점 → 관찰한 행동 1-2개 명시 → 지속 요청", "성장 인정": "이전 대비 발전한 점 → 구체적 변화 포인트 → 앞으로의 기대" },
  directing:   { "행동 제안": "현 상황 1문장 → 구체적 액션 1–3개 (동사 시작) → 기한·기준 명시", "우선순위 정렬": "현재 업무 나열 → 집중 포인트 1개 선택 이유 → 나머지 처리 방향", "기준 제시": "판단 기준 명시 → 적용 예시 1개 → 향후 동일 상황 대처법" },
  developing:  { "경험 의미화": "지금 업무의 성장 가치 → 이 경험이 쌓이는 역량 → 미래 활용 가능성", "자산화 유도": "경험 기록 방법 제안 → 재활용 시나리오 1개 구체화 → 실행 요청", "시야 확장": "현재 업무 → 연결되는 큰 그림 → 팀·조직 차원의 의미" },
  correcting:  { "행동 교정": "관찰한 행동 사실 → 기대 행동과의 차이 → 구체적 변화 요청 (배려 있게)", "인식 교정": "잘못된 판단 기준 짚기 → 올바른 관점 제시 → 재발 방지 질문", "재발 방지": "실수 원인 1가지 → 예방 루틴·체크포인트 → 다음 실행 시 적용 요청" },
  supporting:  { "과부하 인지": "부서장이 상황을 인식하고 있음 전달 → 구체적 부담 공감 → 지원 가능한 것 명시", "심리적 안전": "실패·이견을 말해도 괜찮다는 신호 → 과거 사례 인용 또는 본인 경험 공유 → 앞으로도 말해달라는 요청", "관계 유지": "평가와 무관한 인간적 관심 → 안부·노고 표현 → 가벼운 연결 마무리" },
  aligning:    { "맥락 공유": "개인 업무 → 전체 프로젝트 내 위치 → 왜 지금 이 일이 중요한지", "기대 명확화": "기대 행동 구체화 → 성공 기준 1-2개 → 부서장이 지원 가능한 것", "팀 연결": "개인 업무 → 팀 전체 흐름 연결 → 동료에게 미치는 긍정적 영향" },
  delegating:  { "권한 이양": "위임 범위 명확히 → 결정 가능한 것·불가한 것 경계 → 신뢰 표현", "자율적 실행 요청": "역량 인정 → 방법론은 본인이 선택 → 중간 체크포인트만 요청", "자기결정 지지": "팀원이 내린 판단 언급 → 지지 의사 표현 → 필요 시 후원 약속" },
  informing:   { "현황 보고": "현재 진행 상태 → 주요 리스크 1-2개 → 다음 예정 사항", "조기 경보": "이슈 발생 시점·원인 → 파급 범위 예측 → 선제 대응 방향 제안", "현장 체감 공유": "수치로 안 보이는 팀 부하·분위기 → 구체적 사례 1개 → 경영진 인지 요청" },
  proposing:   { "자원 요청": "필요 자원 종류·규모 → 근거 (현재 갭) → 미확보 시 리스크", "프로세스 개선 제안": "비효율 발견 내용 → 구체적 개선안 → 예상 효과 수치화", "우선순위 조정 건의": "현재 우선순위 문제점 → 조정 제안 → 현장 관점 근거" },
  alerting:    { "기술적 리스크": "리스크 내용 → 파급 가능성·임계점 → 대응 옵션 1-2개", "일정 리스크": "지연 가능성 원인 → 예상 영향 범위 → 의사결정 필요 시점", "조직·역량 리스크": "핵심 인력 상태 → 이탈·과부하 징후 → 선제 조치 요청" },
  reporting:   { "완료 보고": "완료 항목 → 수치 결과 → 다음 단계 (3-part 구조)", "효과 검증": "의사결정 내용 → 실제 효과 수치 → 추가 개선 포인트", "예외 사항 보고": "계획 대비 달라진 점 → 원인 → 조치 내용 또는 요청 사항" },
  advocating:  { "반론·이견 제시": "경영 방향 인지 → 현장 판단과의 차이 → 근거 중심 정중한 공식화", "우선순위 이견": "경영진 관심 밖 항목 → 중요성 근거 → 우선순위 재검토 요청", "팀원 옹호": "팀원 성과·처우 상황 → 기여 내용 구체화 → 부서장으로서 공식 전달" },
  requesting:  { "의사결정 요청": "결정 필요 사항 명시 → 선택 가능한 옵션 → 권고안과 근거 → 결정 요청", "자원 배정 승인": "필요 자원 종류·규모 → 미확보 시 리스크 → 승인 요청 및 기한", "우선순위 확정 요청": "현 우선순위 갈등 상황 → 경영진 판단이 필요한 이유 → 확정 기한 요청" }
};

const clsState = { direction: null, type: null, subtype: null, intensity: null };

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

const INTENSITY_CONFIG = {
  "간결": {
    sysHint: "메신저 스타일로 2–4문장 이내, 핵심만 간결하게 작성합니다. 불필요한 수식어 없이 직접적으로 전달합니다.",
    condition: "2–4문장 이내, 메신저 톤, 핵심 메시지만 전달",
  },
  "표준": {
    sysHint: "전문적이고 격식 있는 어투로 5–8문장으로 작성합니다. 자연스러운 흐름으로 구성합니다.",
    condition: "5–8문장, 이메일 스타일, 구조적이되 자연스럽게",
  },
  "상세": {
    sysHint: "공식 문서 수준의 완결된 격식체로 작성합니다. 상황 → 핵심 → 의지·제안 순으로 구성합니다.",
    condition: "상황 → 핵심 → 의지·제안 완결 구조, 공문 수준 서술",
  },
};

function buildPromptFromClassification() {
  const cls = clsState;
  const direction = cls.direction;
  const dirData = direction ? CLASSIFY_DATA[direction] : null;
  const typeData = (dirData && cls.type) ? dirData.types.find(t => t.id === cls.type) : null;
  const intensityCfg = INTENSITY_CONFIG[cls.intensity] || INTENSITY_CONFIG["표준"];

  const sysLines = [];
  if (direction === "Top-down") {
    sysLines.push("당신은 IT 프로젝트를 총괄하는 부서장입니다. 팀원이 제출한 내용을 읽고 코칭 피드백 메시지를 작성합니다.");
  } else if (direction === "Bottom-up") {
    sysLines.push("당신은 IT 프로젝트를 총괄하는 부서장입니다. 현장 내용을 바탕으로 경영진에게 전달할 메시지를 작성합니다.");
  } else {
    sysLines.push("당신은 기업 비즈니스 커뮤니케이션 전문가입니다. 피드백에 대한 격식체 답변을 작성합니다.");
  }
  sysLines.push(intensityCfg.sysHint);
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
  conditions.push(intensityCfg.condition);

  const introText = direction === "Top-down"
    ? "다음 팀원 보고 내용을 바탕으로 코칭 메시지를 작성해주세요:"
    : direction === "Bottom-up"
    ? "다음 내용을 바탕으로 경영진에게 전달할 메시지를 작성해주세요:"
    : "다음 피드백에 대한 답변을 작성해주세요:";

  return {
    systemText: sysLines.join(" "),
    conditionText: conditions.map(c => `- ${c}`).join("\n"),
    introText,
  };
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
      messages: [
        { role: "system", content: systemText },
        { role: "user", content:
          introText + "\n\n" +
          feedbackText + "\n\n" +
          "작성 조건:\n" +
          conditionText +
          "\n- 본문만 작성 (메일 서식 없음)"
        }
      ]
    };

    const text = await callOpenAI(apiKey, body, document.querySelector(".reply-label"));
    document.getElementById("reply-text").value = text;
  } catch (e) {
    showError("reply-error", e.message);
  } finally {
    setLoading("reply", false);
    const labelEl = document.querySelector(".reply-label");
    if (labelEl) labelEl.textContent = "답변 생성";
  }
}

// --- OpenAI API ---
async function callOpenAI(apiKey, body, statusEl) {
  if (statusEl) statusEl.textContent = MODEL + " 처리 중...";

  let res, data;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({ model: MODEL, ...body }),
    });
    data = await res.json();
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? "응답 파싱 오류가 발생했습니다." : "네트워크 연결을 확인하세요.");
  }

  if (res.ok) {
    const choice = data.choices?.[0];
    if (!choice) throw new Error("응답에 결과가 없습니다.");
    const { finish_reason } = choice;
    if (finish_reason && finish_reason !== "stop" && finish_reason !== "length") {
      throw new Error("생성이 중단되었습니다: " + finish_reason);
    }
    const text = choice.message?.content;
    if (!text) throw new Error("응답에서 텍스트를 찾을 수 없습니다.");
    return text;
  }

  const rawMsg = data.error?.message || "";
  if (res.status === 429) throw new Error("요청 한도 초과. 잠시 후 다시 시도해주세요.");
  if (res.status === 503) throw new Error("서버 오류. 잠시 후 다시 시도해주세요.");
  throw new Error(rawMsg || "API 오류가 발생했습니다.");
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
  const previewImg = document.getElementById("preview-img");
  if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);
  previewImg.src = "";
  previewImg.style.display = "none";
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
document.getElementById("model-badge").textContent = MODEL;
