"use strict";

/* Student Task Manager — клієнт розширеної версії (робота з REST API). */

const PRIORITY_LABELS = { low: "Низький", medium: "Середній", high: "Високий" };

const state = {
  user: null,
  categories: [],
  tasks: [],
  editingId: null,
  filters: { q: "", status: "", priority: "", category: "", sort: "created_desc" },
  loading: false,
};

const $ = (selector) => document.querySelector(selector);

const el = {
  authView: $("#auth-view"),
  appView: $("#app-view"),
  toast: $("#toast"),
  tabLogin: $("#tab-login"),
  tabRegister: $("#tab-register"),
  loginForm: $("#login-form"),
  loginFeedback: $("#login-feedback"),
  registerForm: $("#register-form"),
  registerFeedback: $("#register-feedback"),
  userLine: $("#user-line"),
  logout: $("#logout-button"),
  form: $("#task-form"),
  formTitle: $("#form-title"),
  title: $("#task-title"),
  description: $("#task-description"),
  deadline: $("#task-deadline"),
  priority: $("#task-priority"),
  category: $("#task-category"),
  feedback: $("#task-feedback"),
  submit: $("#task-submit"),
  cancel: $("#task-cancel"),
  list: $("#task-list"),
  loading: $("#loading-state"),
  error: $("#error-state"),
  empty: $("#empty-state"),
  search: $("#search"),
  filterStatus: $("#filter-status"),
  filterPriority: $("#filter-priority"),
  filterCategory: $("#filter-category"),
  sort: $("#sort"),
  countAll: $("#count-all"),
  countActive: $("#count-active"),
  countDone: $("#count-done"),
};

/* ---------- допоміжні функції ---------- */

let toastTimer = null;
function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("toast--error", isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
}

function setFeedback(node, message) {
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function markInvalid(input, invalid) {
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    signal,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error ?? `Помилка запиту (${response.status})`);
    error.status = response.status;
    error.fieldErrors = payload?.fieldErrors ?? null;
    throw error;
  }
  return payload;
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

/* ---------- авторизація ---------- */

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  el.tabLogin.setAttribute("aria-selected", String(isLogin));
  el.tabRegister.setAttribute("aria-selected", String(!isLogin));
  el.loginForm.hidden = !isLogin;
  el.registerForm.hidden = isLogin;
  setFeedback(el.loginFeedback, "");
  setFeedback(el.registerFeedback, "");
  (isLogin ? $("#login-email") : $("#register-name")).focus();
}

el.tabLogin.addEventListener("click", () => switchAuthTab("login"));
el.tabRegister.addEventListener("click", () => switchAuthTab("register"));

function showApp(user) {
  state.user = user;
  el.authView.hidden = true;
  el.appView.hidden = false;
  el.userLine.textContent = `Мої навчальні завдання · ${user.name}`;
  loadCategories().then(loadTasks);
}

function resetFilters() {
  state.filters = { q: "", status: "", priority: "", category: "", sort: "created_desc" };
  el.search.value = "";
  el.filterStatus.value = "";
  el.filterPriority.value = "";
  el.filterCategory.value = "";
  el.sort.value = "created_desc";
}

function showAuth() {
  state.user = null;
  state.tasks = [];
  resetFilters();
  el.appView.hidden = true;
  el.authView.hidden = false;
  el.loginForm.reset();
  $("#login-email").focus();
}

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFeedback(el.loginFeedback, "");
  markInvalid($("#login-email"), false);
  markInvalid($("#login-password"), false);

  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const button = el.loginForm.querySelector("button[type=submit]");

  if (!email || !password) {
    setFeedback(el.loginFeedback, "Заповніть електронну адресу та пароль.");
    return;
  }

  button.disabled = true;
  try {
    const { user } = await api("/api/auth/login", { method: "POST", body: { email, password } });
    el.loginForm.reset();
    showApp(user);
    showToast(`Вітаємо, ${user.name}!`);
  } catch (error) {
    if (error.fieldErrors) {
      markInvalid($("#login-email"), Boolean(error.fieldErrors.email));
      markInvalid($("#login-password"), Boolean(error.fieldErrors.password));
    }
    setFeedback(el.loginFeedback, error.message);
  } finally {
    button.disabled = false;
  }
});

el.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFeedback(el.registerFeedback, "");

  const payload = {
    name: $("#register-name").value.trim(),
    email: $("#register-email").value.trim(),
    password: $("#register-password").value,
    password_confirm: $("#register-password-confirm").value,
  };
  const inputs = {
    name: $("#register-name"),
    email: $("#register-email"),
    password: $("#register-password"),
    password_confirm: $("#register-password-confirm"),
  };
  Object.values(inputs).forEach((input) => markInvalid(input, false));

  const localErrors = {};
  if (payload.name.length < 2) localErrors.name = "Вкажіть ім’я (мінімум 2 символи).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) localErrors.email = "Вкажіть коректну електронну адресу.";
  if (payload.password.length < 8) localErrors.password = "Пароль має містити щонайменше 8 символів.";
  if (payload.password !== payload.password_confirm) localErrors.password_confirm = "Паролі не збігаються.";

  if (Object.keys(localErrors).length) {
    for (const [field, message] of Object.entries(localErrors)) {
      markInvalid(inputs[field], true);
      setFeedback(el.registerFeedback, message);
    }
    return;
  }

  const button = el.registerForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const { user } = await api("/api/auth/register", { method: "POST", body: payload });
    el.registerForm.reset();
    showApp(user);
    showToast("Обліковий запис створено. Вітаємо!");
  } catch (error) {
    if (error.fieldErrors) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        if (inputs[field]) markInvalid(inputs[field], true);
        setFeedback(el.registerFeedback, message);
      }
    } else {
      setFeedback(el.registerFeedback, error.message);
    }
  } finally {
    button.disabled = false;
  }
});

el.logout.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* навіть якщо сервер не відповів, повертаємось на екран входу */
  }
  resetTaskForm();
  showAuth();
  showToast("Ви вийшли з облікового запису.");
});

/* ---------- категорії ---------- */

async function loadCategories() {
  try {
    const { categories } = await api("/api/categories");
    state.categories = categories;

    el.category.replaceChildren(new Option("Без дисципліни", ""), ...categories.map((c) => new Option(c.name, String(c.id))));
    el.filterCategory.replaceChildren(new Option("Усі", ""), ...categories.map((c) => new Option(c.name, String(c.id))));
  } catch (error) {
    showToast(error.message, true);
  }
}

/* ---------- завдання ---------- */

function buildQuery() {
  const params = new URLSearchParams();
  const { q, status, priority, category, sort } = state.filters;
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (category) params.set("category", category);
  if (sort) params.set("sort", sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

let loadController = null;

async function loadTasks() {
  if (!state.user) return;

  loadController?.abort();
  loadController = new AbortController();
  state.loading = true;
  el.loading.hidden = false;
  el.error.hidden = true;

  try {
    const { tasks } = await api(`/api/tasks${buildQuery()}`, { signal: loadController.signal });
    state.tasks = tasks;
    renderTasks();
  } catch (error) {
    if (error.name === "AbortError") return;
    el.error.hidden = false;
    el.error.textContent = error.status === 401
      ? "Сесія завершилась. Увійдіть повторно."
      : "Не вдалося завантажити завдання. Перевірте, чи запущений сервер, і спробуйте ще раз.";
    if (error.status === 401) showAuth();
  } finally {
    state.loading = false;
    el.loading.hidden = true;
  }
}

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

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(createBadge(task.status === "done" ? "Виконано" : "Активне", task.status));
  if (task.priority === "high") badges.append(createBadge("Високий пріоритет", "high"));
  if (task.priority === "low") badges.append(createBadge("Низький пріоритет", "low"));
  if (isOverdue(task)) badges.append(createBadge("Прострочено", "active"));

  const title = document.createElement("h3");
  title.className = "task__title";
  title.textContent = task.title;

  const meta = document.createElement("p");
  meta.className = "task__meta";
  meta.textContent = `${task.category ?? "Без дисципліни"} · до ${formatDate(task.deadline)} · пріоритет: ${PRIORITY_LABELS[task.priority]}`;

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
  toggle.setAttribute("aria-label", `${toggle.textContent}: ${task.title}`);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn--small btn--secondary";
  edit.dataset.action = "edit";
  edit.textContent = "Редагувати";
  edit.setAttribute("aria-label", `Редагувати: ${task.title}`);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn--small btn--danger";
  remove.dataset.action = "delete";
  remove.textContent = "Видалити";
  remove.setAttribute("aria-label", `Видалити: ${task.title}`);

  actions.append(toggle, edit, remove);
  item.append(actions);
  return item;
}

function renderTasks() {
  el.list.replaceChildren(...state.tasks.map(renderTask));

  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.status === "done").length;
  el.countAll.textContent = String(total);
  el.countActive.textContent = String(total - done);
  el.countDone.textContent = String(done);

  const hasFilters = Boolean(state.filters.q || state.filters.status || state.filters.priority || state.filters.category);

  if (total > 0) {
    el.empty.hidden = true;
    return;
  }

  el.empty.hidden = false;
  el.empty.textContent = hasFilters
    ? "За вашим запитом нічого не знайдено. Змініть пошук або фільтри."
    : "Завдань ще немає. Додайте перше завдання у формі ліворуч.";
}

/* ---------- форма завдання ---------- */

function resetTaskForm() {
  state.editingId = null;
  el.form.reset();
  el.priority.value = "medium";
  el.category.value = "";
  el.formTitle.textContent = "Нове завдання";
  el.submit.textContent = "Додати завдання";
  el.cancel.hidden = true;
  setFeedback(el.feedback, "");
  markInvalid(el.title, false);
}

function startEdit(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  state.editingId = id;
  el.title.value = task.title;
  el.description.value = task.description;
  el.deadline.value = task.deadline ?? "";
  el.priority.value = task.priority;
  el.category.value = task.category_id ? String(task.category_id) : "";
  el.formTitle.textContent = "Редагування завдання";
  el.submit.textContent = "Зберегти зміни";
  el.cancel.hidden = false;
  setFeedback(el.feedback, "");
  renderTasks();
  el.title.focus();
  if (window.innerWidth < 900) el.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    title: el.title.value.trim(),
    description: el.description.value.trim(),
    deadline: el.deadline.value,
    priority: el.priority.value,
    category_id: el.category.value ? Number(el.category.value) : null,
  };

  markInvalid(el.title, false);
  setFeedback(el.feedback, "");

  if (!payload.title) {
    markInvalid(el.title, true);
    setFeedback(el.feedback, "Назва обов’язкова: поле не може бути порожнім або містити лише пробіли.");
    el.title.focus();
    return;
  }

  el.submit.disabled = true;
  try {
    if (state.editingId === null) {
      const { task } = await api("/api/tasks", { method: "POST", body: payload });
      showToast(`Завдання «${task.title}» додано.`);
    } else {
      const { task } = await api(`/api/tasks/${state.editingId}`, { method: "PUT", body: payload });
      showToast(`Зміни до завдання «${task.title}» збережено.`);
    }
    resetTaskForm();
    await loadTasks();
  } catch (error) {
    if (error.fieldErrors) {
      markInvalid(el.title, Boolean(error.fieldErrors.title));
      markInvalid(el.deadline, Boolean(error.fieldErrors.deadline));
      setFeedback(el.feedback, Object.values(error.fieldErrors)[0]);
    } else {
      setFeedback(el.feedback, error.message);
    }
  } finally {
    el.submit.disabled = false;
  }
});

el.cancel.addEventListener("click", () => {
  resetTaskForm();
  renderTasks();
  showToast("Редагування скасовано.");
});

el.title.addEventListener("input", () => {
  if (el.title.value.trim()) markInvalid(el.title, false);
});

/* ---------- дії зі списком ---------- */

el.list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = button.closest(".task");
  if (!item) return;
  const id = Number(item.dataset.id);
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task) return;

  button.disabled = true;
  try {
    if (button.dataset.action === "toggle") {
      const status = task.status === "done" ? "active" : "done";
      await api(`/api/tasks/${id}`, { method: "PATCH", body: { status } });
      showToast(status === "done" ? `«${task.title}» позначено виконаним.` : `«${task.title}» повернуто до активних.`);
      await loadTasks();
    } else if (button.dataset.action === "edit") {
      startEdit(id);
    } else if (button.dataset.action === "delete") {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      if (state.editingId === id) resetTaskForm();
      showToast(`Завдання «${task.title}» видалено.`);
      await loadTasks();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

/* ---------- пошук, фільтри, сортування ---------- */

let searchTimer = null;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.q = el.search.value.trim();
    loadTasks();
  }, 300);
});

el.filterStatus.addEventListener("change", () => {
  state.filters.status = el.filterStatus.value;
  loadTasks();
});

el.filterPriority.addEventListener("change", () => {
  state.filters.priority = el.filterPriority.value;
  loadTasks();
});

el.filterCategory.addEventListener("change", () => {
  state.filters.category = el.filterCategory.value;
  loadTasks();
});

el.sort.addEventListener("change", () => {
  state.filters.sort = el.sort.value;
  loadTasks();
});

/* ---------- запуск ---------- */

(async function boot() {
  try {
    const { user } = await api("/api/auth/me");
    showApp(user);
  } catch {
    showAuth();
  }
})();
