// ==== КОНФИГУРАЦИЯ ====
// Замени на адрес своего задеплоенного бэкенда (см. инструкцию по деплою)
const API_BASE_URL = "https://your-backend-domain.example.com";

const STORAGE_KEY = "goggins_plan_state_v1";
const RING_CIRCUMFERENCE = 553; // 2 * PI * 88, совпадает с index.html

const MOTIVATION_LINES = [
  "Никаких оправданий. Открой план и закрой задачу прямо сейчас.",
  "Пока ты сомневаешься — время уходит. Двигайся.",
  "Дисциплина не спрашивает твоего настроения.",
  "Каждая закрытая задача — шаг ближе к цели.",
  "Ты не устал. Ты просто ищешь причину не делать.",
];

const ICON_CHECK = '<svg class="icon" style="width:14px;height:14px;stroke:#000" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
const ICON_TRASH = '<svg class="icon" style="width:15px;height:15px" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>';
const ICON_CALENDAR = '<svg class="icon" style="width:12px;height:12px" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

// ==== TELEGRAM WEBAPP ====
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) {
    try { tg.setHeaderColor("#000000"); } catch (e) {}
  }
  if (tg.setBackgroundColor) {
    try { tg.setBackgroundColor("#000000"); } catch (e) {}
  }
}

function getUserId() {
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
    return tg.initDataUnsafe.user.id;
  }
  let localId = localStorage.getItem("debug_user_id");
  if (!localId) {
    localId = String(Math.floor(Math.random() * 1000000));
    localStorage.setItem("debug_user_id", localId);
  }
  return Number(localId);
}

const USER_ID = getUserId();

// ==== СОСТОЯНИЕ ====
let state = {
  goal: { title: "Моя главная цель" },
  tasks: [],
};

let expandedTaskIds = new Set();
let selectedPriority = "important";
let activeFilter = "all";
let searchQuery = "";
let syncTimer = null;

// ==== ЛОКАЛЬНОЕ ХРАНИЛИЩЕ ====
function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.tasks) state = parsed;
    } catch (e) {
      console.warn("Не удалось разобрать локальное состояние", e);
    }
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ==== СИНХРОНИЗАЦИЯ С БЭКЕНДОМ ====
async function fetchStateFromServer() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/state?user_id=${USER_ID}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.tasks) {
      state = { goal: data.goal || state.goal, tasks: data.tasks };
      saveLocalState();
      renderAll();
    }
  } catch (e) {
    console.warn("Бэкенд недоступен, работаем локально", e);
  }
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(pushStateToServer, 800);
}

async function pushStateToServer() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: USER_ID,
        goal_title: state.goal.title,
        tasks: state.tasks,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.tasks) {
        state = { goal: data.goal, tasks: data.tasks };
        saveLocalState();
        renderAll();
      }
    }
  } catch (e) {
    console.warn("Не удалось синхронизировать с бэкендом", e);
  }
}

// ==== РАСЧЁТ ПРОГРЕССА ====
function calcProgress() {
  let total = 0, done = 0;
  state.tasks.forEach((task) => {
    if (task.subtasks && task.subtasks.length > 0) {
      task.subtasks.forEach((st) => { total += 1; if (st.done) done += 1; });
    } else {
      total += 1; if (task.done) done += 1;
    }
  });
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

function syncTaskDoneFromSubtasks(task) {
  if (task.subtasks && task.subtasks.length > 0) {
    task.done = task.subtasks.every((s) => s.done);
  }
}

// ==== РЕНДЕР: СТАТИСТИКА ====
function renderStats() {
  document.getElementById("stat-total").textContent = String(state.tasks.length);
  const doneCount = state.tasks.filter((t) => t.done).length;
  document.getElementById("stat-done").textContent = String(doneCount);
}

// ==== РЕНДЕР: ГЛАВНАЯ ====
function renderHome() {
  const titleEl = document.getElementById("goal-title");
  if (document.activeElement !== titleEl) {
    titleEl.textContent = state.goal.title || "Моя главная цель";
  }

  const progress = calcProgress();
  const ring = document.getElementById("progress-ring");
  const number = document.getElementById("progress-number");
  const offset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * progress) / 100;
  ring.style.strokeDashoffset = String(offset);
  number.textContent = `${progress}%`;

  const line = document.getElementById("motivation-line");
  const idx = Math.min(MOTIVATION_LINES.length - 1, Math.floor((progress / 100) * MOTIVATION_LINES.length));
  line.textContent = MOTIVATION_LINES[idx];
}

// ==== РЕНДЕР: ПЛАН ====
function priorityBadge(priority) {
  if (priority === "important") {
    return `<span class="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 uppercase tracking-wide">Важно</span>`;
  }
  return `<span class="text-[10px] font-bold px-2 py-1 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/30 uppercase tracking-wide">Второстепенно</span>`;
}

function formatDeadline(deadline) {
  if (!deadline) return "";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function getFilteredTasks() {
  return state.tasks.filter((task) => {
    const matchesFilter = activeFilter === "all" || task.priority === activeFilter;
    const matchesSearch = !searchQuery || task.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
}

function renderFilterTabs() {
  document.querySelectorAll(".filter-tab").forEach((btn) => {
    const active = btn.dataset.filter === activeFilter;
    btn.className = `filter-tab pb-1 border-b-2 ${active ? "border-emerald-500 text-white" : "border-transparent text-zinc-500"}`;
  });
}

function renderPlan() {
  renderFilterTabs();

  const list = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const filtered = getFilteredTasks();
  list.innerHTML = "";

  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  filtered.forEach((task) => {
    const isExpanded = expandedTaskIds.has(task.id);
    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const doneCount = hasSubtasks ? task.subtasks.filter((s) => s.done).length : 0;

    const card = document.createElement("div");
    card.className = "glass rounded-2xl p-4 fade-in";

    const deadlineHtml = task.deadline
      ? `<span class="text-[11px] text-zinc-500 font-semibold flex items-center gap-1">${ICON_CALENDAR} ${formatDeadline(task.deadline)}</span>`
      : "";

    card.innerHTML = `
      <div class="flex items-start gap-3">
        <button class="task-checkbox mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors
          ${task.done ? "bg-emerald-500 border-emerald-500" : "border-zinc-700"}"
          data-task-id="${task.id}" ${hasSubtasks ? "disabled" : ""}>
          ${task.done ? ICON_CHECK : ""}
        </button>

        <div class="flex-1 min-w-0 cursor-pointer task-expand-trigger" data-task-id="${task.id}">
          <p class="font-bold text-white text-sm break-words ${task.done ? "line-through text-zinc-500" : ""}">${escapeHtml(task.title)}</p>
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            ${priorityBadge(task.priority)}
            ${deadlineHtml}
            ${hasSubtasks ? `<span class="text-[11px] text-emerald-400 font-semibold">${doneCount}/${task.subtasks.length}</span>` : ""}
          </div>
        </div>

        <button class="task-delete text-zinc-700 hover:text-red-400 px-1" data-task-id="${task.id}">${ICON_TRASH}</button>
      </div>

      <div class="subtasks-wrap ${isExpanded ? "" : "hidden"} mt-4 pl-9 flex flex-col gap-2" data-task-id="${task.id}">
        ${(task.subtasks || [])
          .map(
            (st) => `
          <div class="flex items-center gap-2">
            <button class="subtask-checkbox w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0
              ${st.done ? "bg-emerald-500 border-emerald-500" : "border-zinc-700"}"
              data-task-id="${task.id}" data-subtask-id="${st.id}">
              ${st.done ? ICON_CHECK : ""}
            </button>
            <p class="flex-1 text-xs text-zinc-300 ${st.done ? "line-through text-zinc-600" : ""}">${escapeHtml(st.title)}</p>
            <button class="subtask-delete text-zinc-700 hover:text-red-400" data-task-id="${task.id}" data-subtask-id="${st.id}">${ICON_TRASH}</button>
          </div>
        `
          )
          .join("")}
        <div class="flex items-center gap-2 mt-1">
          <input type="text" placeholder="Новый пункт..." class="subtask-input flex-1 bg-base-700/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500" data-task-id="${task.id}" />
          <button class="subtask-add text-emerald-400 font-bold text-sm px-2" data-task-id="${task.id}">+</button>
        </div>
      </div>
    `;

    list.appendChild(card);
  });

  attachPlanListeners();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ==== ОБРАБОТЧИКИ: ПЛАН ====
function attachPlanListeners() {
  document.querySelectorAll(".task-checkbox").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.taskId);
      const task = state.tasks.find((t) => t.id === id);
      if (!task || (task.subtasks && task.subtasks.length > 0)) return;
      task.done = !task.done;
      onStateChanged();
    });
  });

  document.querySelectorAll(".task-expand-trigger").forEach((el) => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.taskId);
      if (expandedTaskIds.has(id)) expandedTaskIds.delete(id);
      else expandedTaskIds.add(id);
      renderPlan();
    });
  });

  document.querySelectorAll(".task-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.taskId);
      state.tasks = state.tasks.filter((t) => t.id !== id);
      onStateChanged();
    });
  });

  document.querySelectorAll(".subtask-checkbox").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = Number(btn.dataset.taskId);
      const subtaskId = Number(btn.dataset.subtaskId);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const subtask = task.subtasks.find((s) => s.id === subtaskId);
      if (!subtask) return;
      subtask.done = !subtask.done;
      syncTaskDoneFromSubtasks(task);
      onStateChanged();
    });
  });

  document.querySelectorAll(".subtask-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = Number(btn.dataset.taskId);
      const subtaskId = Number(btn.dataset.subtaskId);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
      syncTaskDoneFromSubtasks(task);
      onStateChanged();
    });
  });

  document.querySelectorAll(".subtask-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = Number(btn.dataset.taskId);
      const input = document.querySelector(`.subtask-input[data-task-id="${taskId}"]`);
      addSubtask(taskId, input.value);
      input.value = "";
    });
  });

  document.querySelectorAll(".subtask-input").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const taskId = Number(input.dataset.taskId);
        addSubtask(taskId, input.value);
        input.value = "";
      }
    });
  });
}

function addSubtask(taskId, title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];
  task.subtasks.push({ id: generateLocalId(), title: trimmed, done: false });
  syncTaskDoneFromSubtasks(task);
  onStateChanged();
}

function generateLocalId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

// ==== ОБЩИЙ ОБРАБОТЧИК ИЗМЕНЕНИЙ ====
function onStateChanged() {
  saveLocalState();
  renderAll();
  scheduleSync();
  if (tg && tg.HapticFeedback) {
    try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {}
  }
}

function renderAll() {
  renderStats();
  renderHome();
  renderPlan();
}

// ==== НАВИГАЦИЯ ====
function showScreen(name) {
  document.getElementById("screen-home").classList.toggle("hidden", name !== "home");
  document.getElementById("screen-plan").classList.toggle("hidden", name !== "plan");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.screen === name;
    btn.classList.toggle("nav-active", active);
    btn.classList.toggle("nav-idle", !active);
  });

  if (name === "home") renderHome();
  if (name === "plan") renderPlan();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

// ==== ФИЛЬТРЫ И ПОИСК ====
document.querySelectorAll(".filter-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    renderPlan();
  });
});

document.getElementById("search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderPlan();
});

// ==== НАСТРОЙКИ (ТИХИЕ ЧАСЫ ЧЕРЕЗ БОТА) ====
document.getElementById("btn-settings").addEventListener("click", () => {
  if (tg && tg.showPopup) {
    tg.showPopup({
      title: "Тихие часы",
      message: "Чтобы настроить время без уведомлений, вернись в чат с ботом и отправь команду /quiet, например: /quiet 23:00 08:00",
      buttons: [{ type: "ok" }],
    });
  }
});

// ==== РЕДАКТИРОВАНИЕ НАЗВАНИЯ ЦЕЛИ ====
const goalTitleEl = document.getElementById("goal-title");
goalTitleEl.addEventListener("blur", () => {
  const newTitle = goalTitleEl.textContent.trim() || "Моя главная цель";
  state.goal.title = newTitle;
  onStateChanged();
});
goalTitleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    goalTitleEl.blur();
  }
});

// ==== МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ ЗАДАЧИ ====
const modal = document.getElementById("modal-task");
const btnAddTask = document.getElementById("btn-add-task");
const btnCancelTask = document.getElementById("btn-cancel-task");
const btnSaveTask = document.getElementById("btn-save-task");
const inputTitle = document.getElementById("input-task-title");
const inputDeadline = document.getElementById("input-task-deadline");

function openModal() {
  inputTitle.value = "";
  inputDeadline.value = "";
  selectedPriority = "important";
  updatePriorityButtons();
  modal.classList.remove("hidden");
  setTimeout(() => inputTitle.focus(), 100);
}

function closeModal() {
  modal.classList.add("hidden");
}

function updatePriorityButtons() {
  document.querySelectorAll(".priority-btn").forEach((btn) => {
    const active = btn.dataset.priority === selectedPriority;
    if (btn.dataset.priority === "important") {
      btn.className = `priority-btn flex-1 py-3 rounded-xl border font-bold text-sm ${active ? "border-red-500/60 text-red-400 bg-red-500/15" : "border-zinc-800 text-zinc-500"}`;
    } else {
      btn.className = `priority-btn flex-1 py-3 rounded-xl border font-bold text-sm ${active ? "border-sky-500/60 text-sky-400 bg-sky-500/15" : "border-zinc-800 text-zinc-500"}`;
    }
  });
}

document.querySelectorAll(".priority-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedPriority = btn.dataset.priority;
    updatePriorityButtons();
  });
});

btnAddTask.addEventListener("click", openModal);
btnCancelTask.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

btnSaveTask.addEventListener("click", () => {
  const title = inputTitle.value.trim();
  if (!title) { inputTitle.focus(); return; }
  state.tasks.push({
    id: generateLocalId(),
    title,
    deadline: inputDeadline.value || null,
    priority: selectedPriority,
    done: false,
    subtasks: [],
  });
  closeModal();
  onStateChanged();
});

// ==== ИНИЦИАЛИЗАЦИЯ ====
async function init() {
  loadLocalState();
  showScreen("home");
  renderAll();
  await fetchStateFromServer();
}

init();
