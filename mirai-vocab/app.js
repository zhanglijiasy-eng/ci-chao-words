import { wordGroups } from "./wordData.js";

const STORE = "mirai-vocab-progress-v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  track: "小学分类",
  selectedGroup: wordGroups[0]?.id,
  queue: [],
  current: null,
  lastItems: [],
  total: 0,
  answered: 0,
  misses: 0,
  examMode: false,
  pendingMistake: false,
  progress: loadProgress(),
};

function defaultProgress() {
  return { mastered: {}, mistakes: {}, stars: 0, combo: 0, xp: 0 };
}

function loadProgress() {
  try {
    return { ...defaultProgress(), ...(JSON.parse(localStorage.getItem(STORE)) || {}) };
  } catch {
    return defaultProgress();
  }
}

function saveProgress() {
  localStorage.setItem(STORE, JSON.stringify(state.progress));
}

function groupByTrack() {
  return wordGroups.reduce((acc, group) => {
    (acc[group.track] ||= []).push(group);
    return acc;
  }, {});
}

function currentGroup() {
  return wordGroups.find((group) => group.id === state.selectedGroup) || wordGroups[0];
}

function lessonsFor(items) {
  const size = items.length > 80 ? 16 : 12;
  const lessons = [];
  for (let i = 0; i < items.length; i += size) lessons.push(items.slice(i, i + size));
  return lessons;
}

function sample(items, count) {
  return [...items].sort(() => Math.random() - 0.5).slice(0, count);
}

function normalize(text) {
  return String(text || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function switchView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${name}View`).classList.add("active");
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $("#screenTitle").textContent = { map: "音阶地图", train: "共鸣训练", mistakes: "错题调音台", exam: "自选范围考试", codex: "音符词库" }[name];
  if (name === "exam") renderExam();
  if (name === "mistakes") renderMistakes();
  if (name === "codex") renderCodex();
}

function renderStats() {
  $("#masteredCount").textContent = Object.keys(state.progress.mastered).length;
  $("#starCount").textContent = state.progress.stars || 0;
  $("#comboCount").textContent = state.progress.combo || 0;
  $("#xpBar").style.width = `${Math.min(100, ((state.progress.xp || 0) % 100))}%`;
}

function renderMap() {
  const tracks = Object.keys(groupByTrack());
  $("#trackTabs").innerHTML = tracks.map((track) => `<button class="${track === state.track ? "active" : ""}" data-track="${track}">${track}</button>`).join("");
  $$("#trackTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.track = button.dataset.track;
      state.selectedGroup = groupByTrack()[state.track][0].id;
      renderMap();
    });
  });

  const groups = groupByTrack()[state.track] || [];
  $("#zoneGrid").innerHTML = groups.map((group, index) => {
    const done = group.items.filter((item) => state.progress.mastered[item.id]).length;
    const percent = Math.round(done / group.items.length * 100);
    return `
      <button class="zone ${group.id === state.selectedGroup ? "selected" : ""}" data-group="${group.id}">
        <span>${index + 1}</span>
        <strong>${group.title}</strong>
        <small>${group.items.length} 词 · ${percent}%</small>
      </button>
    `;
  }).join("");
  $$(".zone").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedGroup = button.dataset.group;
      renderMap();
    });
  });
  renderLessons();
}

function renderLessons() {
  const group = currentGroup();
  const lessons = lessonsFor(group.items);
  $("#zoneTitle").textContent = group.title;
  $("#zoneMeta").textContent = `${group.track} · ${group.items.length} 个词，已拆成 ${lessons.length} 个小关卡。`;
  $("#lessonList").innerHTML = lessons.map((lesson, index) => {
    const done = lesson.filter((item) => state.progress.mastered[item.id]).length;
    return `
      <button class="lesson" data-index="${index}">
        <span>Stage ${index + 1}</span>
        <strong>${lesson[0].word} → ${lesson[lesson.length - 1].word}</strong>
        <small>${done}/${lesson.length} 已点亮</small>
      </button>
    `;
  }).join("");
  $$(".lesson").forEach((button) => {
    button.addEventListener("click", () => startTraining(lessons[Number(button.dataset.index)], `${group.title} · Stage ${Number(button.dataset.index) + 1}`));
  });
}

function startTraining(items, label = "今日训练") {
  state.examMode = false;
  state.queue = sample(items, items.length);
  state.lastItems = [...items];
  state.total = items.length;
  state.answered = 0;
  state.misses = 0;
  state.pendingMistake = false;
  switchView("train");
  $("#lessonLabel").textContent = label;
  nextQuestion();
}

function nextQuestion() {
  state.pendingMistake = false;
  state.misses = 0;
  $("#feedback").textContent = "";
  $("#feedback").className = "feedback";
  $("#mistakeActions").classList.remove("show", "confirming");
  const item = state.queue.shift();
  if (!item) {
    state.current = null;
    $("#questionText").textContent = state.examMode ? "考试完成" : "本轮完成";
    $("#metaText").textContent = state.examMode ? examAdvice() : "可以返回地图，也可以再来一轮。";
    $("#answerForm").innerHTML = "";
    updateHelper(true);
    return;
  }
  state.current = item;
  $("#questionText").textContent = item.meaning;
  $("#metaText").textContent = [item.partOfSpeech, item.source, item.unit].filter(Boolean).join(" · ");
  renderAnswer(item.word);
  updateHelper(false);
}

function renderAnswer(word) {
  $("#answerForm").innerHTML = `
    <span class="inline-label">填写完整英文</span>
    <input class="full-input" id="fullInput" autocomplete="off" spellcheck="false" />
    <button class="submit" type="submit">确认</button>
  `;
  $("#fullInput").focus();
}

function updateHelper(done) {
  const percent = state.total ? Math.round((done ? state.total : state.answered) / state.total * 100) : 0;
  $("#helperTitle").textContent = done ? "演出完成" : (state.examMode ? "考试演出" : "单词共鸣");
  $("#progressBar").style.width = `${percent}%`;
  $("#questionIndex").textContent = `${Math.min(state.answered + (done ? 0 : 1), state.total)}/${state.total}`;
  $("#missCount").textContent = state.misses;
  $("#helperTip").textContent = state.examMode ? "按所选范围出题，结束后会提示薄弱分区。" : "看中文提示，直接默写完整英文。短语按空格输入即可。";
}

function answerCurrent() {
  if (!state.current) return;
  const correct = normalize($("#fullInput").value) === normalize(state.current.word);
  if (state.examMode) {
    state.current.examCorrect = correct;
    state.answered += 1;
    $("#feedback").textContent = correct ? "答对了，下一题。" : `本题答案：${state.current.word}`;
    $("#feedback").className = correct ? "feedback good" : "feedback bad";
    setTimeout(nextQuestion, correct ? 450 : 1000);
    return;
  }
  if (correct) {
    state.progress.mastered[state.current.id] = (state.progress.mastered[state.current.id] || 0) + 1;
    delete state.progress.mistakes[state.current.id];
    state.progress.stars += 1;
    state.progress.combo += 1;
    state.progress.xp += 10;
    state.answered += 1;
    saveProgress();
    renderStats();
    $("#feedback").textContent = "点亮成功，进入下一词。";
    $("#feedback").className = "feedback good";
    setTimeout(nextQuestion, 500);
  } else {
    state.misses += 1;
    state.progress.combo = 0;
    saveProgress();
    $("#feedback").textContent = "还没对。可以重新回答，或先加入错题集复盘。";
    $("#feedback").className = "feedback bad";
    $("#mistakeActions").classList.add("show");
    updateHelper(false);
  }
}

function revealMistake() {
  if (!state.current) return;
  state.pendingMistake = true;
  $("#feedback").innerHTML = `<div class="answer-reveal"><span>正确答案</span><strong>${state.current.word}</strong><small>${state.current.meaning}</small></div>`;
  $("#mistakeActions").classList.add("confirming");
}

function confirmMistake() {
  if (!state.current || !state.pendingMistake) return;
  state.progress.mistakes[state.current.id] = (state.progress.mistakes[state.current.id] || 0) + 1;
  saveProgress();
  renderStats();
  renderMistakes();
  state.answered += 1;
  $("#mistakeActions").classList.remove("show", "confirming");
  $("#feedback").textContent = "已加入错题集，继续下一题。";
  setTimeout(nextQuestion, 750);
}

function retryQuestion() {
  $("#fullInput").value = "";
  $("#fullInput").focus();
  $("#mistakeActions").classList.remove("show", "confirming");
  $("#feedback").textContent = "再试一次。";
}

function speakCurrent() {
  if (!state.current || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(state.current.word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function renderMistakes() {
  const items = Object.keys(state.progress.mistakes).map((id) => allWords().find((item) => item.id === id)).filter(Boolean);
  $("#mistakeGrid").innerHTML = items.length ? items.map(wordCard).join("") : `<div class="empty">错题集是空的。</div>`;
}

function allWords() {
  return wordGroups.flatMap((group) => group.items);
}

function renderExam() {
  const sources = [];
  wordGroups.forEach((group) => {
    lessonsFor(group.items).forEach((lesson, index) => {
      sources.push({ id: `${group.id}:${index}`, group: group.title, label: `Stage ${index + 1} (${lesson.length}题)`, items: lesson });
    });
  });
  $("#examPanel").innerHTML = `
    <div class="exam-head"><p>选择考试范围，最小单位是每个 Stage。</p><div><button id="allExam">全选</button><button id="noneExam">清空</button></div></div>
    <div class="exam-list">${sources.map((source) => `
      <label><input type="checkbox" value="${source.id}" checked /><span>${source.group} · ${source.label}</span></label>
    `).join("")}</div>
  `;
  $("#examPanel").dataset.sources = JSON.stringify(sources.map((source) => ({ id: source.id, itemIds: source.items.map((item) => item.id) })));
  $("#allExam").addEventListener("click", () => $$("#examPanel input").forEach((input) => { input.checked = true; }));
  $("#noneExam").addEventListener("click", () => $$("#examPanel input").forEach((input) => { input.checked = false; }));
}

function startExam() {
  const selected = new Set($$("#examPanel input:checked").map((input) => input.value));
  const sourceDefs = JSON.parse($("#examPanel").dataset.sources || "[]");
  const wordMap = new Map(allWords().map((item) => [item.id, item]));
  const pool = sourceDefs.filter((source) => selected.has(source.id)).flatMap((source) => source.itemIds.map((id) => wordMap.get(id)).filter(Boolean));
  if (!pool.length) return showToast("请先选择考试范围。");
  state.examMode = true;
  state.queue = sample(pool, Math.min(20, pool.length));
  state.lastItems = [...state.queue];
  state.total = state.queue.length;
  state.answered = 0;
  switchView("train");
  $("#lessonLabel").textContent = "自选范围考试";
  nextQuestion();
}

function examAdvice() {
  const done = state.lastItems.filter((item) => item.examCorrect !== undefined);
  const bad = done.filter((item) => !item.examCorrect);
  if (!bad.length) return "本次全对，继续挑战更大范围。";
  const counts = bad.reduce((acc, item) => {
    acc[item.unit] = (acc[item.unit] || 0) + 1;
    return acc;
  }, {});
  const weak = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([unit]) => unit).join("、");
  return `建议重点复习：${weak}`;
}

function renderCodex() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const items = allWords().filter((item) => !q || `${item.word} ${item.meaning} ${item.unit}`.toLowerCase().includes(q)).slice(0, 360);
  $("#wordGrid").innerHTML = items.map(wordCard).join("");
}

function wordCard(item) {
  return `<article class="word ${state.progress.mastered[item.id] ? "lit" : ""}"><strong>${item.word}</strong><p>${item.meaning}</p><small>${item.unit}</small></article>`;
}

function showToast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
}

function bind() {
  $$(".nav").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#answerForm").addEventListener("submit", (event) => { event.preventDefault(); answerCurrent(); });
  $("#speakBtn").addEventListener("click", speakCurrent);
  $("#startDaily").addEventListener("click", () => startTraining(sample(allWords().filter((item) => !state.progress.mastered[item.id]), 20), "今日训练"));
  $("#backMap").addEventListener("click", () => switchView("map"));
  $("#againBtn").addEventListener("click", () => state.lastItems.length && startTraining(state.lastItems, "再来一轮"));
  $("#retryBtn").addEventListener("click", retryQuestion);
  $("#addMistakeBtn").addEventListener("click", revealMistake);
  $("#confirmMistakeBtn").addEventListener("click", confirmMistake);
  $("#startMistakes").addEventListener("click", () => {
    const items = Object.keys(state.progress.mistakes).map((id) => allWords().find((item) => item.id === id)).filter(Boolean);
    if (items.length) startTraining(items, "错题复习");
    else showToast("错题集是空的。");
  });
  $("#startExam").addEventListener("click", startExam);
  $("#searchInput").addEventListener("input", renderCodex);
  $("#resetProgress").addEventListener("click", () => {
    if (confirm("确定清空本机学习进度吗？")) {
      state.progress = defaultProgress();
      saveProgress();
      renderStats(); renderMap(); renderMistakes(); renderCodex();
    }
  });
}

bind();
renderStats();
renderMap();
renderExam();
renderCodex();
