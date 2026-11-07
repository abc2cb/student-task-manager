"use strict";

/*
 * Student Task Manager — MVP практичної роботи №16.
 * Дані зберігаються в масиві в пам'яті сторінки (без localStorage, без сервера).
 */

const PRIORITY_LABELS = { low: "Низький", medium: "Середній", high: "Високий" };
const FILTERS = ["all", "active", "done"];

const state = {
  tasks: [],
  filter: "all",
  editingId: null,
  nextId: 1,
};

const elements = {
  form: document.querySelector("#task-form"),
  formTitle: document.querySelector("#form-title"),
  name: document.querySelector("#name"),
  category: document.querySelector("#category"),
  deadline: document.querySelector("#deadline"),
  priority: document.querySelector("#priority"),
  description: document.querySelector("#description"),
  submit: document.querySelector("#submit-button"),
  cancelEdit: document.querySelector("#cancel-edit"),
  feedback: document.querySelector("#form-feedback"),
  list: document.querySelector("#task-list"),
  empty: document.querySelector("#empty-state"),
  countAll: document.querySelector("#count-all"),
  countActive: document.querySelector("#count-active"),
  countDone: document.querySelector("#count-done"),
  filters: [...document.querySelectorAll("[data-filter]")],
};

/* ---------- допоміжні функції ---------- */

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function findTask(id) {
  return state.tasks.find((task) => task.id === id) ?? null;
}

function setFeedback(message, isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.classList.toggle("is-error", isError);
}

function formatDate(isoDate) {
  if (!isoDate) return "без терміну";
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "некоректна дата";
  return date.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

function isOverdue(task) {
  if (!task.deadline || task.status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${task.deadline}T00:00:00`) < today;
}

function visibleTasks() {
  if (state.filter === "active") return state.tasks.filter((task) => task.status === "active");
  if (state.filter === "done") return state.tasks.filter((task) => task.status === "done");
  return state.tasks.slice();
}

function validateForm() {
  const name = normalizeName(elements.name.value);
  if (!name) {
    elements.name.setAttribute("aria-invalid", "true");
    elements.name.focus();
    setFeedback("Введіть назву завдання: поле не може бути порожнім або містити лише пробіли.", true);
    return null;
  }
  elements.name.removeAttribute("aria-invalid");
  return {
    name,
    category: elements.category.value,
    deadline: elements.deadline.value,
    priority: elements.priority.value,
    description: elements.description.value.trim(),
  };
}

/* ---------- відображення ---------- */

function createBadge(text, modifier) {
  const badge = document.createElement("span");
  badge.className = `badge${modifier ? ` badge--${modifier}` : ""}`;
  badge.textContent = text;
  return badge;
}

function renderTask(task) {
  const item = document.createElement("li");
  item.className = "task";
  item.dataset.id = String(task.id);
  item.dataset.status = task.status;
  item.dataset.priority = task.priority;
  if (state.editingId === task.id) item.classList.add("is-editing");

  const title = document.createElement("h3");
  title.className = "task__title";
  title.textContent = task.name;

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(createBadge(task.status === "done" ? "Виконано" : "Активне", task.status));
  if (task.priority === "high") badges.append(createBadge("Високий пріоритет", "high"));
  if (task.priority === "low") badges.append(createBadge("Низький пріоритет", "low"));
  if (isOverdue(task)) badges.append(createBadge("Прострочено", "active"));

  const meta = document.createElement("p");
  meta.className = "task__meta";
  meta.textContent = `${task.category} · до ${formatDate(task.deadline)} · пріоритет: ${PRIORITY_LABELS[task.priority]}`;

  item.append(badges, title, meta);

  if (task.description) {
    const description = document.createElement("p");
    description.className = "task__description";
    description.textContent = task.description;
    item.append(description);
  }

  const actions = document.createElement("div");
  actions.className = "task__actions";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn--small btn--secondary";
  toggle.dataset.action = "toggle";
  toggle.textContent = task.status === "done" ? "Повернути до активних" : "Позначити виконаним";
  toggle.setAttribute("aria-label", `${toggle.textContent}: ${task.name}`);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn--small btn--secondary";
  edit.dataset.action = "edit";
  edit.textContent = "Редагувати";
  edit.setAttribute("aria-label", `Редагувати: ${task.name}`);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn--small btn--danger";
  remove.dataset.action = "delete";
  remove.textContent = "Видалити";
  remove.setAttribute("aria-label", `Видалити: ${task.name}`);

  actions.append(toggle, edit, remove);
  item.append(actions);
  return item;
}

function render() {
  const tasks = visibleTasks();
  elements.list.replaceChildren(...tasks.map(renderTask));

  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.status === "done").length;
  elements.countAll.textContent = String(total);
  elements.countActive.textContent = String(total - done);
  elements.countDone.textContent = String(done);

  elements.filters.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter));
  });

  if (tasks.length === 0) {
    elements.empty.hidden = false;
    elements.empty.textContent = total === 0
      ? "Завдань поки немає. Додайте перше завдання у формі ліворуч."
      : "Немає завдань для вибраного фільтра.";
  } else {
    elements.empty.hidden = true;
    elements.empty.textContent = "";
  }
}

/* ---------- дії з даними ---------- */

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  elements.priority.value = "medium";
  elements.name.removeAttribute("aria-invalid");
  elements.formTitle.textContent = "Нове завдання";
  elements.submit.textContent = "Додати завдання";
  elements.cancelEdit.hidden = true;
}

function startEdit(id) {
  const task = findTask(id);
  if (!task) return;
  state.editingId = id;
  elements.name.value = task.name;
  elements.category.value = task.category;
  elements.deadline.value = task.deadline;
  elements.priority.value = task.priority;
  elements.description.value = task.description;
  elements.formTitle.textContent = "Редагування завдання";
  elements.submit.textContent = "Зберегти зміни";
  elements.cancelEdit.hidden = false;
  setFeedback(`Редагується завдання «${task.name}».`);
  elements.name.focus();
  render();
}

function createTask(data) {
  state.tasks.push({
    id: state.nextId++,
    name: data.name,
    description: data.description,
    category: data.category,
    deadline: data.deadline,
    priority: data.priority,
    status: "active",
  });
  setFeedback(`Завдання «${data.name}» додано до списку.`);
}

function updateTask(id, data) {
  const task = findTask(id);
  if (!task) return false;
  Object.assign(task, data);
  return true;
}

function toggleTask(id) {
  const task = findTask(id);
  if (!task) return;
  task.status = task.status === "done" ? "active" : "done";
  setFeedback(task.status === "done"
    ? `Завдання «${task.name}» позначено виконаним.`
    : `Завдання «${task.name}» повернуто до активних.`);
}

function deleteTask(id) {
  const task = findTask(id);
  if (!task) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  if (state.editingId === id) resetForm();
  setFeedback(`Завдання «${task.name}» видалено.`);
}

/* ---------- обробники ---------- */

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = validateForm();
  if (!data) return;

  if (state.editingId === null) {
    createTask(data);
  } else if (updateTask(state.editingId, data)) {
    setFeedback(`Зміни до завдання «${data.name}» збережено.`);
  }

  resetForm();
  render();
  elements.name.focus();
});

elements.cancelEdit.addEventListener("click", () => {
  resetForm();
  setFeedback("Редагування скасовано, дані завдання не змінено.");
  render();
});

elements.name.addEventListener("input", () => {
  if (elements.name.value.trim()) elements.name.removeAttribute("aria-invalid");
});

elements.filters.forEach((button) => {
  button.addEventListener("click", () => {
    if (!FILTERS.includes(button.dataset.filter)) return;
    state.filter = button.dataset.filter;
    render();
  });
});

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = button.closest(".task");
  if (!item) return;
  const id = Number(item.dataset.id);

  if (button.dataset.action === "toggle") toggleTask(id);
  else if (button.dataset.action === "edit") startEdit(id);
  else if (button.dataset.action === "delete") deleteTask(id);

  render();
});

render();
