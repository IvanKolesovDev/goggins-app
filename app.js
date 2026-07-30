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
const ICON_PHONE = '<svg class="icon" style="width:12px;height:12px" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>';

const CLIENT_STATUSES = {
  new: { label: "Новый", classes: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  in_progress: { label: "В работе", classes: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  callback: { label: "Перезвонить", classes: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  closed: { label: "Закрыт", classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

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
  clients: [],
};

let expandedTaskIds = new Set();
let selectedPriority = "important";
let activeFilter = "all";
let searchQuery = "";
let syncTimer = null;

let selectedClientStatus = "new";
let editingClientId = null;
let activeCrmStatusFilter = "all";

// ==== ЛОКАЛЬНОЕ ХРАНИЛИЩЕ ====
function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.tasks) {
        state = parsed;
        if (!state.clients) state.clients = [];
      }
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
      state = {
        goal: data.goal || state.goal,
        tasks: data.tasks,
        clients: data.clients || [],
      };
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
        clients: state.clients,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.tasks) {
        state = { goal: data.goal, tasks: data.tasks, clients: data.clients || [] };
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

// ==== РЕНДЕР: ЦЕЛЬ ====
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

function formatCallDatetime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const datePart = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const timePart = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
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

// ==== РЕНДЕР: CRM ====
function getFilteredClients() {
  if (activeCrmStatusFilter === "all") return state.clients;
  return state.clients.filter((c) => c.status === activeCrmStatusFilter);
}

function renderCrmTabs() {
  document.querySelectorAll(".crm-tab").forEach((btn) => {
    const active = btn.dataset.statusFilter === activeCrmStatusFilter;
    btn.className = `crm-tab shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border ${
      active ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/50" : "border-white/10 text-zinc-500"
    }`;
  });
}

function renderCRM() {
  renderCrmTabs();

  const list = document.getElementById("client-list");
  const emptyState = document.getElementById("crm-empty-state");
  const filtered = getFilteredClients();
  list.innerHTML = "";

  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  filtered.forEach((client) => {
    const statusMeta = CLIENT_STATUSES[client.status] || CLIENT_STATUSES.new;
    const callHtml = client.call_datetime
      ? `<span class="text-[11px] text-zinc-500 font-semibold flex items-center gap-1">${ICON_CALENDAR} ${formatCallDatetime(client.call_datetime)}</span>`
      : "";

    const card = document.createElement("div");
    card.className = "glass rounded-2xl p-4 fade-in";
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
            ${ICON_PHONE}
          </div>
          <p class="font-bold text-white text-sm break-words">${escapeHtml(client.contact)}</p>
        </div>
        <button class="client-delete text-zinc-700 hover:text-red-400 px-1 shrink-0" data-client-id="${client.id}">${ICON_TRASH}</button>
      </div>

      <div class="flex items-center gap-2 mt-3 flex-wrap">
        <select class="client-status-select text-[10px] font-bold px-2 py-1 rounded-lg border uppercase tracking-wide ${statusMeta.classes}" data-client-id="${client.id}">
          ${Object.entries(CLIENT_STATUSES)
            .map(
              ([key, meta]) =>
                `<option value="${key}" ${key === client.status ? "selected" : ""}>${meta.label}</option>`
            )
            .join("")}
        </select>
        ${callHtml}
      </div>

      ${
        client.description
          ? `<p class="text-xs text-zinc-400 mt-3 leading-relaxed break-words">${escapeHtml(client.description)}</p>`
          : ""
      }

      <button class="client-edit-trigger w-full text-left mt-3 text-[11px] text-emerald-400 font-semibold" data-client-id="${client.id}">
        Редактировать карточку
      </button>
    `;

    list.appendChild(card);
  });

  attachCrmListeners();
}

function attachCrmListeners() {
  document.querySelectorAll(".client-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.clientId);
      state.clients = state.clients.filter((c) => c.id !== id);
      onStateChanged();
      renderCRM();
    });
  });

  document.querySelectorAll(".client-status-select").forEach((select) => {
    select.addEventListener("change", () => {
      const id = Number(select.dataset.clientId);
      const client = state.clients.find((c) => c.id === id);
      if (!client) return;
      client.status = select.value;
      onStateChanged();
      renderCRM();
    });
  });

  document.querySelectorAll(".client-edit-trigger").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.clientId);
      openClientModal(id);
    });
  });
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
  renderCRM();
}

// ==== НАВИГАЦИЯ ====
function showScreen(name) {
  document.getElementById("screen-home").classList.toggle("hidden", name !== "home");
  document.getElementById("screen-plan").classList.toggle("hidden", name !== "plan");
  document.getElementById("screen-crm").classList.toggle("hidden", name !== "crm");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.screen === name;
    btn.classList.toggle("nav-active", active);
    btn.classList.toggle("nav-idle", !active);
  });

  if (name === "home") renderHome();
  if (name === "plan") renderPlan();
  if (name === "crm") renderCRM();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

document.querySelectorAll(".crm-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeCrmStatusFilter = btn.dataset.statusFilter;
    renderCRM();
  });
});

// ==== ФИЛЬТРЫ И ПОИСК (ПЛАН) ====
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
const modalTask = document.getElementById("modal-task");
const btnAddTask = document.getElementById("btn-add-task");
const btnCancelTask = document.getElementById("btn-cancel-task");
const btnSaveTask = document.getElementById("btn-save-task");
const inputTitle = document.getElementById("input-task-title");
const inputDeadline = document.getElementById("input-task-deadline");

function openTaskModal() {
  inputTitle.value = "";
  inputDeadline.value = "";
  selectedPriority = "important";
  updatePriorityButtons();
  modalTask.classList.remove("hidden");
  setTimeout(() => inputTitle.focus(), 100);
}

function closeTaskModal() {
  modalTask.classList.add("hidden");
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

btnAddTask.addEventListener("click", openTaskModal);
btnCancelTask.addEventListener("click", closeTaskModal);
modalTask.addEventListener("click", (e) => { if (e.target === modalTask) closeTaskModal(); });

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
  closeTaskModal();
  onStateChanged();
});

// ==== МОДАЛЬНОЕ ОКНО ЛИДА (CRM) ====
const modalClient = document.getElementById("modal-client");
const btnAddClient = document.getElementById("btn-add-client");
const btnCancelClient = document.getElementById("btn-cancel-client");
const btnSaveClient = document.getElementById("btn-save-client");
const inputClientContact = document.getElementById("input-client-contact");
const inputClientDatetime = document.getElementById("input-client-datetime");
const inputClientDescription = document.getElementById("input-client-description");
const clientModalTitle = document.getElementById("client-modal-title");

function updateClientStatusButtons() {
  document.querySelectorAll(".client-status-btn").forEach((btn) => {
    const active = btn.dataset.status === selectedClientStatus;
    const meta = CLIENT_STATUSES[btn.dataset.status];
    btn.className = `client-status-btn py-3 rounded-xl border font-bold text-sm ${
      active ? meta.classes : "border-zinc-800 text-zinc-500"
    }`;
  });
}

document.querySelectorAll(".client-status-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedClientStatus = btn.dataset.status;
    updateClientStatusButtons();
  });
});

function openClientModal(clientId) {
  editingClientId = clientId || null;

  if (editingClientId) {
    const client = state.clients.find((c) => c.id === editingClientId);
    if (!client) return;
    clientModalTitle.textContent = "Редактировать лида";
    inputClientContact.value = client.contact || "";
    inputClientDatetime.value = client.call_datetime || "";
    inputClientDescription.value = client.description || "";
    selectedClientStatus = client.status || "new";
  } else {
    clientModalTitle.textContent = "Новый лид";
    inputClientContact.value = "";
    inputClientDatetime.value = "";
    inputClientDescription.value = "";
    selectedClientStatus = "new";
  }

  updateClientStatusButtons();
  modalClient.classList.remove("hidden");
  setTimeout(() => inputClientContact.focus(), 100);
}

function closeClientModal() {
  modalClient.classList.add("hidden");
  editingClientId = null;
}

btnAddClient.addEventListener("click", () => openClientModal(null));
btnCancelClient.addEventListener("click", closeClientModal);
modalClient.addEventListener("click", (e) => { if (e.target === modalClient) closeClientModal(); });

btnSaveClient.addEventListener("click", () => {
  const contact = inputClientContact.value.trim();
  if (!contact) { inputClientContact.focus(); return; }

  if (editingClientId) {
    const client = state.clients.find((c) => c.id === editingClientId);
    if (client) {
      client.contact = contact;
      client.call_datetime = inputClientDatetime.value || null;
      client.status = selectedClientStatus;
      client.description = inputClientDescription.value.trim();
    }
  } else {
    state.clients.push({
      id: generateLocalId(),
      contact,
      call_datetime: inputClientDatetime.value || null,
      status: selectedClientStatus,
      description: inputClientDescription.value.trim(),
    });
  }

  closeClientModal();
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
