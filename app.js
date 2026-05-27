import { vocabulary } from "./vocabulary.js";
import { knowledgeUnits } from "./knowledge.js";

const STORAGE_KEY = "ci-chao-progress-v3";
const LEGACY_STORAGE_KEY = "ci-chao-progress-v2";
const SESSION_MINUTES = 45;
const WARNING_MINUTES = 3;

const roles = [
  { id: "rover_m", name: "漂泊者·男", title: "潮声行者", mark: "漂" },
  { id: "rover_f", name: "漂泊者·女", title: "回响行者", mark: "泊" },
  { id: "yangyang", name: "秧秧", title: "风息向导", mark: "秧" },
  { id: "chixia", name: "炽霞", title: "热能先锋", mark: "炽" },
  { id: "baizhi", name: "白芷", title: "调律医师", mark: "芷" },
];
const zoneNames = {
  "Unit 1": "潮声港",
  "Unit 2": "星砂原野",
  "Unit 3": "回音林站",
  "Unit 4": "无音高塔",
  "Unit 5": "流光城环",
  "Unit 6": "绿洲深井",
};

const lessonNames = {
  "Unit 1": ["万象新声·上", "万象新声·下", "嘤鸣初相召", "撞金止行阵", "奔策候残星"],
  "Unit 2": ["不撞南墙不回头", "止戈关麟", "永不消逝的琴声", "等闲平地起波澜"],
  "Unit 3": ["沉默的历史", "散华伴星", "荣光之影", "撞金止行阵·续", "今州夜归人"],
  "Unit 4": ["惶惶欲动", "暗潮将映的黎明", "猎取残像之人", "往岁乘霄醒惊蛰", "此际我独行"],
  "Unit 5": ["行至海岸尽头", "在海中遗落的湛蓝回声", "邀回荡之冠", "暗主降临", "誓与长风同去"],
  "Unit 6": ["潮落之后", "重返隐海", "叩天关", "向着天上之月"],
};

const mapNodes = {
  "Unit 1": { x: 14, y: 72 },
  "Unit 2": { x: 26, y: 38 },
  "Unit 3": { x: 44, y: 58 },
  "Unit 4": { x: 60, y: 28 },
  "Unit 5": { x: 76, y: 50 },
  "Unit 6": { x: 88, y: 22 },
};

const mapIcons = {
  "Unit 1": "港",
  "Unit 2": "星",
  "Unit 3": "林",
  "Unit 4": "塔",
  "Unit 5": "城",
  "Unit 6": "井",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  selectedUnit: "Unit 1",
  selectedLesson: null,
  selectedKnowledge: null,
  lastBattleItems: [],
  queue: [],
  current: null,
  currentMode: "meaning",
  answered: false,
  awaitingRetry: false,
  examMode: false,
  examSession: null,
  filterUnit: "all",
  activeRoleId: null,
  progress: defaultProgress(),
  allProgress: loadAllProgress(),
  sessionEndsAt: null,
  warned: false,
  timerId: null,
};

function unitNumber(unit) {
  const match = String(unit).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function unitOrder(a, b) {
  return unitNumber(a) - unitNumber(b) || String(a).localeCompare(String(b));
}

function defaultProgress() {
  return { mastered: {}, mistakes: {}, knowledgeDone: {}, stars: 0, streak: 0, xp: 0, minutesPlayed: 0, sessions: 0 };
}

function normalizeProgress(progress = {}) {
  return {
    ...defaultProgress(),
    ...progress,
    mastered: progress.mastered || {},
    mistakes: progress.mistakes || {},
    knowledgeDone: progress.knowledgeDone || {},
  };
}

function loadAllProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.roles) return saved;
  } catch {
    // Fall through to migration/default.
  }
  const rolesProgress = {};
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) rolesProgress[roles[0].id] = normalizeProgress(legacy);
  } catch {
    // Ignore malformed legacy saves.
  }
  return { roles: rolesProgress };
}

function saveProgress() {
  if (!state.activeRoleId) return;
  state.allProgress.roles[state.activeRoleId] = normalizeProgress(state.progress);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.allProgress));
}

function roleProgress(roleId) {
  return normalizeProgress(state.allProgress.roles[roleId]);
}

function progressPercent(progress) {
  return Math.round(Object.keys(progress.mastered || {}).length / vocabulary.length * 100);
}

function enterRole(roleId) {
  const role = roles.find((item) => item.id === roleId) || roles[0];
  if (state.activeRoleId && state.activeRoleId !== role.id) {
    saveProgress();
  }
  state.activeRoleId = role.id;
  state.progress = roleProgress(role.id);
  if (!state.sessionEndsAt || !$(".app-shell").classList.contains("active")) {
    state.progress.sessions = (state.progress.sessions || 0) + 1;
  }
  state.sessionEndsAt = Date.now() + SESSION_MINUTES * 60 * 1000;
  state.warned = false;
  saveProgress();
  $("#loginScreen").classList.add("hidden");
  $(".app-shell").classList.add("active");
  $("#activeRoleName").textContent = role.name;
  $(".avatar-core").textContent = role.mark;
  renderStats();
  renderMap();
  renderMistakes();
  renderCodex();
  startTimer();
}

function exitToLogin(message = "已自动存档，回到角色选择。") {
  if (state.activeRoleId && state.sessionEndsAt) {
    const elapsedMs = SESSION_MINUTES * 60 * 1000 - Math.max(0, state.sessionEndsAt - Date.now());
    const elapsedMinutes = Math.max(0, Math.min(SESSION_MINUTES, Math.round(elapsedMs / 60000)));
    state.progress.minutesPlayed = (state.progress.minutesPlayed || 0) + elapsedMinutes;
  }
  saveProgress();
  state.activeRoleId = null;
  state.progress = defaultProgress();
  state.queue = [];
  state.current = null;
  state.sessionEndsAt = null;
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
  $(".app-shell").classList.remove("active");
  $("#loginScreen").classList.remove("hidden");
  renderLogin();
  showToast(message);
}

function startTimer() {
  if (state.timerId) clearInterval(state.timerId);
  updateTimer();
  state.timerId = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!state.sessionEndsAt) return;
  const remaining = Math.max(0, state.sessionEndsAt - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  $("#timerText").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  $("#timerCard").classList.toggle("warning", remaining <= WARNING_MINUTES * 60 * 1000);
  if (!state.warned && remaining <= WARNING_MINUTES * 60 * 1000 && remaining > 0) {
    state.warned = true;
    showToast("还剩 3 分钟，本次训练即将自动存档退出。");
  }
  if (remaining <= 0) {
    exitToLogin("45 分钟到，本次训练已自动存档。");
  }
}

function showToast(text) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 4200);
}

function groupedByUnit() {
  const sorted = [...vocabulary].sort((a, b) => unitOrder(a.unit, b.unit) || (a.page || 0) - (b.page || 0));
  return sorted.reduce((acc, item) => {
    (acc[item.unit] ||= []).push(item);
    return acc;
  }, {});
}

function lessonsFor(items) {
  const lessons = [];
  for (let i = 0; i < items.length; i += 8) {
    lessons.push(items.slice(i, i + 8));
  }
  return lessons;
}

function lessonName(unit, index, total) {
  const names = lessonNames[unit] || [];
  if (names[index]) return names[index];
  return index === total - 1 ? `${zoneNames[unit] || unit}首领战` : `共鸣试炼 ${index + 1}`;
}

function sample(array, count, excludeId) {
  return [...array]
    .filter((item) => item.id !== excludeId)
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
}

function normalize(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function compact(text) {
  return normalize(text).replace(/[^a-z0-9]/g, "");
}

function switchView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${name}View`).classList.add("active");
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $("#screenTitle").textContent = { map: "回响地图", battle: "共振训练", review: "失谐回收战", exam: "随机考试", knowledge: "知识关卡", codex: "词汇图鉴" }[name];
  if (name === "review") renderMistakes();
  if (name === "exam") renderExamIntro();
  if (name === "codex") renderCodex();
}

function renderLogin() {
  $("#roleGrid").innerHTML = roles.map((role) => {
    const progress = roleProgress(role.id);
    const mastered = Object.keys(progress.mastered).length;
    const percent = progressPercent(progress);
    const level = Math.max(1, Math.floor((progress.xp || 0) / 80) + 1);
    return `
      <button class="role-card" data-role="${role.id}">
        <span class="role-mark">${role.mark}</span>
        <strong>${role.name}</strong>
        <em>${role.title}</em>
        <div class="role-meter"><span style="width:${percent}%"></span></div>
        <small>Lv.${level} · ${mastered}/${vocabulary.length} · ${percent}%</small>
      </button>
    `;
  }).join("");
}

function renderHomeRoleProgress() {
  $("#homeRoleProgress").innerHTML = roles.map((role) => {
    const progress = roleProgress(role.id);
    const percent = progressPercent(progress);
    const active = role.id === state.activeRoleId ? "active" : "";
    return `
      <button class="mini-role ${active}" data-role="${role.id}">
        <span>${role.mark}</span>
        <div>
          <strong>${role.name}</strong>
          <small>${percent}% · ${Object.keys(progress.mastered).length}/${vocabulary.length}</small>
        </div>
      </button>
    `;
  }).join("");
}

function renderStats() {
  const masteredCount = Object.keys(state.progress.mastered).length;
  $("#totalMastered").textContent = masteredCount;
  $("#totalStars").textContent = state.progress.stars || 0;
  $("#streakCount").textContent = state.progress.streak || 0;
  const level = Math.max(1, Math.floor((state.progress.xp || 0) / 80) + 1);
  $("#levelLabel").textContent = `Lv. ${level}`;
  $("#xpBar").style.width = `${Math.min(100, ((state.progress.xp || 0) % 80) / 80 * 100)}%`;
  renderHomeRoleProgress();
}

function renderMap() {
  const units = groupedByUnit();
  const orderedUnits = Object.entries(units).sort(([a], [b]) => unitOrder(a, b));
  const routePoints = orderedUnits
    .map(([unit]) => mapNodes[unit])
    .filter(Boolean)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  $("#zoneList").innerHTML = `
    <svg class="map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="route-shadow" points="${routePoints}" />
      <polyline class="route-line" points="${routePoints}" />
    </svg>
    ${orderedUnits.map(([unit, items], index) => {
    const mastered = items.filter((item) => state.progress.mastered[item.id]).length;
    const percent = Math.round(mastered / items.length * 100);
    const node = mapNodes[unit] || { x: 50, y: 50 };
    const status = percent >= 100 ? "complete" : percent > 0 ? "started" : "locked";
    return `
      <button class="zone-node ${status} ${unit === state.selectedUnit ? "selected" : ""}" data-unit="${unit}" style="--x:${node.x}%; --y:${node.y}%; --progress:${percent}%">
        <span class="node-aura"></span>
        <span class="node-core"><i>${mapIcons[unit] || "点"}</i><b>${index + 1}</b></span>
        <span class="node-label">
          <strong>${zoneNames[unit] || unit}</strong>
          <small>${unit} · ${percent}%</small>
        </span>
      </button>
    `;
  }).join("")}
  `;

  $$(".zone-node").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedUnit = node.dataset.unit;
      renderMap();
      renderLessons();
      renderKnowledgeLessons();
    });
  });
  renderLessons();
  renderKnowledgeLessons();
}

function renderLessons() {
  const items = groupedByUnit()[state.selectedUnit] || [];
  const lessons = lessonsFor(items);
  $("#selectedZoneName").textContent = `${zoneNames[state.selectedUnit]} · ${state.selectedUnit}`;
  $("#selectedZoneMeta").textContent = `${items.length} 个单词/短语，拆成 ${lessons.length} 个小关卡。`;
  $("#lessonList").innerHTML = lessons.map((lesson, index) => {
    const mastered = lesson.filter((item) => state.progress.mastered[item.id]).length;
    const name = lessonName(state.selectedUnit, index, lessons.length);
    return `
      <button class="lesson-card" data-lesson="${index}">
        <span>${state.selectedUnit} · 第 ${index + 1} 关</span>
        <strong>${name}</strong>
        <em>${lesson[0].word} → ${lesson[lesson.length - 1].word}</em>
        <small>${mastered}/${lesson.length} 已点亮</small>
      </button>
    `;
  }).join("");
  $$(".lesson-card").forEach((card) => {
    const index = Number(card.dataset.lesson);
    card.addEventListener("click", () => startBattle(lessons[index], `${state.selectedUnit} · ${lessonName(state.selectedUnit, index, lessons.length)}`));
  });
}

function knowledgeForUnit(unit) {
  return knowledgeUnits.find((item) => item.unit === unit);
}

function knowledgeKey(unit, levelId) {
  return `${unit}:${levelId}`;
}

function renderKnowledgeLessons() {
  const unitData = knowledgeForUnit(state.selectedUnit);
  const levels = unitData?.levels || [];
  $("#knowledgeList").innerHTML = levels.length ? levels.map((level, index) => {
    const done = state.progress.knowledgeDone[knowledgeKey(state.selectedUnit, level.id)];
    return `
      <button class="knowledge-card ${done ? "done" : ""}" data-level="${level.id}">
        <span>知识 ${index + 1}</span>
        <strong>${level.title}</strong>
        <small>${done ? "已点亮" : "待完成"} · ${unitData.title}</small>
      </button>
    `;
  }).join("") : `<div class="empty-state">这个单元还没有知识关卡。</div>`;
  $$(".knowledge-card").forEach((card) => {
    card.addEventListener("click", () => openKnowledgeLevel(card.dataset.level));
  });
}

function openKnowledgeLevel(levelId) {
  const unitData = knowledgeForUnit(state.selectedUnit);
  const level = unitData?.levels.find((item) => item.id === levelId);
  if (!unitData || !level) return;
  state.selectedKnowledge = { unit: state.selectedUnit, levelId };
  $("#knowledgeUnitLabel").textContent = `${state.selectedUnit} · ${unitData.title}`;
  $("#knowledgeTitle").textContent = level.title;
  $("#knowledgeContent").innerHTML = level.content.map((line) => {
    const cls = /^[（(]?[一二三四五六七八九十]+[）)]|重点|考点|Unit/i.test(line) ? "knowledge-line heading" : "knowledge-line";
    return `<p class="${cls}">${line}</p>`;
  }).join("");
  $("#completeKnowledge").textContent = state.progress.knowledgeDone[knowledgeKey(state.selectedUnit, levelId)] ? "已点亮" : "完成并点亮";
  switchView("knowledge");
}

function completeKnowledgeLevel() {
  if (!state.selectedKnowledge) return;
  const key = knowledgeKey(state.selectedKnowledge.unit, state.selectedKnowledge.levelId);
  state.progress.knowledgeDone[key] = true;
  state.progress.stars = (state.progress.stars || 0) + 1;
  state.progress.xp = (state.progress.xp || 0) + 8;
  saveProgress();
  renderStats();
  renderKnowledgeLessons();
  $("#completeKnowledge").textContent = "已点亮";
  showToast("知识关卡已点亮。");
}

function makeDailyQueue() {
  const mistakes = Object.keys(state.progress.mistakes || {})
    .map((id) => vocabulary.find((item) => item.id === id))
    .filter(Boolean)
    .sort((a, b) => unitOrder(a.unit, b.unit) || (a.page || 0) - (b.page || 0));
  const fresh = [...vocabulary].sort((a, b) => unitOrder(a.unit, b.unit) || (a.page || 0) - (b.page || 0)).filter((item) => !state.progress.mastered[item.id]);
  return [...mistakes.slice(0, 6), ...fresh.slice(0, 14)].slice(0, 20);
}

function startBattle(items, label = "今日训练") {
  state.examMode = false;
  state.examSession = null;
  state.lastBattleItems = [...items];
  state.queue = [...items].sort(() => Math.random() - 0.5);
  state.selectedLesson = label;
  switchView("battle");
  $("#lessonLabel").textContent = label;
  $("#startDaily").textContent = "重新开始";
  nextQuestion();
}

function balancedExamWords() {
  const units = Object.values(groupedByUnit());
  const picked = units.flatMap((items) => sample(items, Math.min(3, items.length)));
  const remaining = vocabulary.filter((item) => !picked.some((word) => word.id === item.id));
  return [...picked, ...sample(remaining, 20 - picked.length)].slice(0, 20).sort(() => Math.random() - 0.5);
}

function startExam() {
  const items = balancedExamWords();
  state.examMode = true;
  state.examSession = {
    total: items.length,
    answers: [],
  };
  state.lastBattleItems = [];
  state.queue = [...items];
  state.selectedLesson = "20 词综合测试";
  switchView("battle");
  $("#lessonLabel").textContent = "随机考试";
  $("#startDaily").textContent = "开始今日训练";
  nextQuestion();
}

function nextQuestion() {
  state.answered = false;
  state.awaitingRetry = false;
  $("#nextQuestion").disabled = true;
  $("#feedback").textContent = "";
  $("#feedback").className = "feedback";
  $("#mistakeActions").classList.remove("show");
  $("#completionActions").classList.remove("show");
  $("#returnMap").textContent = "返回地图";
  $("#setOutAgain").textContent = "再出发";
  $("#inlineAnswer").innerHTML = "";
  const next = state.queue.shift();
  if (!next) {
    if (state.examMode) {
      renderExamResult();
      return;
    }
    $("#questionText").textContent = "本轮调律完成";
    $("#answerGrid").innerHTML = "";
    $("#inlineAnswer").classList.remove("show");
    $("#completionActions").classList.add("show");
    $("#enemyCore").textContent = "✓";
    renderStats();
    renderMap();
    return;
  }
  state.current = next;
  state.currentMode = "spelling";
  $("#enemyCore").textContent = next.word.slice(0, 1).toUpperCase();
  $("#phoneticText").textContent = `${next.phonetic || ""} ${next.partOfSpeech || ""}`.trim();
  $("#battleMode").textContent = "听音频，看中文和首字母提示，填写剩余字母";
  $("#speakBtn").disabled = !("speechSynthesis" in window);

  $("#answerGrid").innerHTML = "";
  renderInlineAnswer(next.word);
  $("#questionText").textContent = next.meaning;
  window.setTimeout(speakCurrent, 260);
}

function maskWord(word) {
  return String(word).replace(/[A-Za-z]+/g, (part) => {
    if (part.length <= 1) return part;
    return `${part[0]}${"_".repeat(part.length - 1)}`;
  });
}

function remainingLetters(word) {
  return String(word).replace(/[A-Za-z]+/g, (part) => part.slice(1));
}

function renderInlineAnswer(word) {
  const form = $("#inlineAnswer");
  let inputIndex = 0;
  const html = String(word).replace(/[A-Za-z]+|[^A-Za-z]+/g, (part) => {
    if (!/[A-Za-z]/.test(part)) return `<span class="answer-separator">${part}</span>`;
    const first = part[0];
    const blanks = part.slice(1).split("").map((letter) => {
      const index = inputIndex++;
      return `<input class="letter-input" data-answer="${letter.toLowerCase()}" data-index="${index}" maxlength="1" autocomplete="off" inputmode="latin" aria-label="第 ${index + 1} 个字母" />`;
    }).join("");
    return `<span class="answer-word"><span class="given-letter">${first}</span>${blanks}</span>`;
  });
  form.innerHTML = `<span class="inline-label">首字母提示</span><div class="inline-lines">${html}</div><button class="inline-submit" id="submitTyping" type="submit">确认</button>`;
  form.classList.add("show");
  const firstInput = form.querySelector(".letter-input");
  if (firstInput) firstInput.focus();
}

function inlineAnswerText() {
  return $$(".letter-input").map((input) => input.value).join("");
}

function isCorrectSpelling(word) {
  return compact(inlineAnswerText()) === compact(remainingLetters(word));
}

function focusFirstBlank() {
  const firstEmpty = $$(".letter-input").find((input) => !input.value);
  (firstEmpty || $(".letter-input"))?.focus();
}

function answer(correct) {
  if (state.answered || !state.current) return;
  if (state.examMode) {
    state.examSession.answers.push({ id: state.current.id, unit: state.current.unit, correct });
    state.answered = true;
    $("#feedback").textContent = correct ? "答对了，进入下一题。" : `本题答案：${state.current.word}`;
    $("#feedback").className = correct ? "feedback good" : "feedback bad";
    window.setTimeout(nextQuestion, correct ? 520 : 1100);
    return;
  }
  if (correct) {
    state.answered = true;
    state.progress.mastered[state.current.id] = (state.progress.mastered[state.current.id] || 0) + 1;
    delete state.progress.mistakes[state.current.id];
    state.progress.streak = (state.progress.streak || 0) + 1;
    state.progress.stars = (state.progress.stars || 0) + 1;
    state.progress.xp = (state.progress.xp || 0) + 12;
    $("#feedback").textContent = `共振成功！${state.current.word} 已点亮。`;
    $("#feedback").className = "feedback good";
    $("#mistakeActions").classList.remove("show");
    saveProgress();
    renderStats();
    window.setTimeout(nextQuestion, 650);
  } else {
    state.progress.streak = 0;
    state.awaitingRetry = true;
    $("#feedback").textContent = "回答不对，再试一次；也可以先加入错题集，之后去失谐回收战专门复习。";
    $("#feedback").className = "feedback bad";
    $("#mistakeActions").classList.add("show");
    $$(".letter-input").forEach((input) => {
      if (input.value && input.value !== input.dataset.answer) input.classList.add("wrong");
    });
    focusFirstBlank();
    saveProgress();
    renderStats();
  }
}

function renderExamIntro() {
  $("#examPanel").innerHTML = `<p>系统会从 Unit 1-6 随机抽取 20 个单词/短语。考试结束后，会根据每个单元正确率给出重点复习建议。</p>`;
}

function renderExamResult() {
  const answers = state.examSession?.answers || [];
  const correct = answers.filter((item) => item.correct).length;
  const byUnit = answers.reduce((acc, item) => {
    (acc[item.unit] ||= { total: 0, correct: 0 });
    acc[item.unit].total += 1;
    if (item.correct) acc[item.unit].correct += 1;
    return acc;
  }, {});
  const unitRows = Object.entries(byUnit).sort(([a], [b]) => unitOrder(a, b)).map(([unit, stat]) => {
    const rate = Math.round(stat.correct / stat.total * 100);
    return { unit, ...stat, rate };
  });
  const weak = unitRows.filter((row) => row.rate < 80).sort((a, b) => a.rate - b.rate);
  const advice = weak.length
    ? `建议重点复习：${weak.map((row) => `${row.unit}（${row.rate}%）`).join("、")}。`
    : "本次各单元都不错，可以继续挑战下一轮综合测试。";

  state.examMode = false;
  $("#questionText").textContent = "考试完成";
  $("#phoneticText").textContent = `得分 ${correct}/${answers.length}`;
  $("#answerGrid").innerHTML = `
    <div class="exam-result">
      <strong>${correct}/${answers.length}</strong>
      <p>${advice}</p>
      <div class="exam-unit-list">
        ${unitRows.map((row) => `
          <div>
            <span>${row.unit}</span>
            <b>${row.correct}/${row.total}</b>
            <small>${row.rate}%</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  $("#inlineAnswer").classList.remove("show");
  $("#inlineAnswer").innerHTML = "";
  $("#mistakeActions").classList.remove("show");
  $("#completionActions").classList.add("show");
  $("#enemyCore").textContent = "分";
  $("#returnMap").textContent = "返回首页";
  $("#setOutAgain").textContent = "再考一次";
  state.lastBattleItems = [];
}

function retryQuestion() {
  if (!state.current) return;
  state.answered = false;
  state.awaitingRetry = false;
  $$(".letter-input").forEach((input) => {
    input.value = "";
    input.classList.remove("wrong");
  });
  $("#feedback").textContent = "重新调律中。";
  $("#feedback").className = "feedback";
  $("#mistakeActions").classList.remove("show");
  focusFirstBlank();
  speakCurrent();
}

function addCurrentMistake() {
  if (!state.current) return;
  state.progress.mistakes[state.current.id] = (state.progress.mistakes[state.current.id] || 0) + 1;
  saveProgress();
  renderStats();
  renderMistakes();
  $("#feedback").textContent = `已加入错题集：${state.current.word} = ${state.current.meaning}`;
  $("#feedback").className = "feedback bad";
  $("#mistakeActions").classList.remove("show");
  state.answered = true;
  window.setTimeout(nextQuestion, 850);
}

function renderMistakes() {
  const items = Object.keys(state.progress.mistakes || {})
    .map((id) => vocabulary.find((item) => item.id === id))
    .filter(Boolean);
  $("#mistakeGrid").innerHTML = items.length ? items.map(wordCard).join("") : `<div class="empty-state">目前没有失谐词。答错后可以手动加入错题集。</div>`;
}

function renderCodex() {
  const query = normalize($("#searchInput").value);
  const items = vocabulary.filter((item) => {
    const unitOk = state.filterUnit === "all" || item.unit === state.filterUnit;
    const textOk = !query || normalize(`${item.word} ${item.meaning} ${item.phonetic}`).includes(query);
    return unitOk && textOk;
  });
  $("#wordGrid").innerHTML = items.map(wordCard).join("");
}

function wordCard(item) {
  const lit = state.progress.mastered[item.id] ? "lit" : "";
  return `
    <article class="word-card ${lit}">
      <div>
        <strong>${item.word}</strong>
        <small>${item.phonetic || item.type}</small>
      </div>
      <p>${item.meaning}</p>
      <footer>${item.unit} · ${item.type}${item.page ? ` · P${item.page}` : ""}</footer>
    </article>
  `;
}

function renderFilters() {
  const units = Object.keys(groupedByUnit()).sort(unitOrder);
  $("#unitFilters").innerHTML = [`<button class="filter active" data-unit="all">全部</button>`, ...units.map((unit) => `<button class="filter" data-unit="${unit}">${unit}</button>`)].join("");
  $$(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.filterUnit = button.dataset.unit;
      $$(".filter").forEach((item) => item.classList.toggle("active", item === button));
      renderCodex();
    });
  });
}

function speakCurrent() {
  if (!state.current || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(state.current.word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function bindEvents() {
  $("#roleGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-role]");
    if (card) enterRole(card.dataset.role);
  });
  $("#homeRoleProgress").addEventListener("click", (event) => {
    const card = event.target.closest("[data-role]");
    if (card && card.dataset.role !== state.activeRoleId) {
      enterRole(card.dataset.role);
      showToast(`已切换到 ${roles.find((role) => role.id === card.dataset.role)?.name || "新角色"}，进度已加载。`);
    }
  });
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#exitRole").addEventListener("click", () => exitToLogin("已存档退出。"));
  $("#startDaily").addEventListener("click", () => startBattle(makeDailyQueue(), "今日训练"));
  $("#startExam").addEventListener("click", startExam);
  $("#nextQuestion").addEventListener("click", nextQuestion);
  $("#retryQuestion").addEventListener("click", retryQuestion);
  $("#addMistake").addEventListener("click", addCurrentMistake);
  $("#returnMap").addEventListener("click", () => switchView("map"));
  $("#backToMap").addEventListener("click", () => switchView("map"));
  $("#completeKnowledge").addEventListener("click", completeKnowledgeLevel);
  $("#setOutAgain").addEventListener("click", () => {
    if (!state.lastBattleItems.length && state.selectedLesson === "20 词综合测试") startExam();
    else if (state.lastBattleItems.length) startBattle(state.lastBattleItems, state.selectedLesson || "再出发");
  });
  $("#inlineAnswer").addEventListener("submit", (event) => {
    event.preventDefault();
    answer(isCorrectSpelling(state.current?.word || ""));
  });
  $("#inlineAnswer").addEventListener("input", (event) => {
    const input = event.target.closest(".letter-input");
    if (!input) return;
    input.value = input.value.replace(/[^a-zA-Z]/g, "").slice(-1).toLowerCase();
    input.classList.remove("wrong");
    if (input.value) {
      const next = $(`.letter-input[data-index="${Number(input.dataset.index) + 1}"]`);
      next?.focus();
    }
  });
  $("#inlineAnswer").addEventListener("keydown", (event) => {
    const input = event.target.closest(".letter-input");
    if (!input) return;
    if (event.key === "Backspace" && !input.value) {
      const previous = $(`.letter-input[data-index="${Number(input.dataset.index) - 1}"]`);
      previous?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      answer(isCorrectSpelling(state.current?.word || ""));
    }
  });
  $("#startMistakes").addEventListener("click", () => {
    const mistakes = Object.keys(state.progress.mistakes || {})
      .map((id) => vocabulary.find((item) => item.id === id))
      .filter(Boolean)
      .sort((a, b) => unitOrder(a.unit, b.unit) || (a.page || 0) - (b.page || 0));
    if (mistakes.length) startBattle(mistakes, "失谐回收战");
    else showToast("错题集现在是空的。");
  });
  $("#searchInput").addEventListener("input", renderCodex);
  $("#speakBtn").addEventListener("click", speakCurrent);
}

bindEvents();
renderFilters();
renderLogin();
renderStats();
renderMap();
renderCodex();
