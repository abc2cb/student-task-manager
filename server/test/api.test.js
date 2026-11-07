"use strict";

/**
 * Інтеграційні перевірки API розширеної версії Student Task Manager.
 * Запуск: npm test
 *
 * Кожен тест працює з реальним HTTP-сервером і тимчасовою базою SQLite,
 * тому перевіряється саме серверна логіка, а не лише клієнтський код.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stm-test-"));
const dbPath = path.join(tmpDir, "test.db");

let app;
let baseUrl;

async function startApp(databasePath) {
  app = createApp({ dbPath: databasePath });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
}

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const session = raw.find((value) => value.startsWith("stm_session="));
  return session ? session.split(";")[0] : "";
}

async function request(method, url, { body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload, cookie: cookieFrom(response) };
}

async function registerUser({ name, email, password }) {
  const response = await request("POST", "/api/auth/register", {
    body: { name, email, password, password_confirm: password },
  });
  assert.equal(response.status, 201, `реєстрація ${email}: ${JSON.stringify(response.payload)}`);
  return response;
}

test.before(async () => {
  await startApp(dbPath);
});

test.after(async () => {
  if (app) await app.close();
});

let userA;
let userB;

test("1. Реєстрація нового користувача створює сесію", async () => {
  userA = await registerUser({ name: "Антон Бєлка", email: "anton@example.com", password: "Password123" });
  assert.equal(userA.payload.user.email, "anton@example.com");
  assert.match(userA.cookie, /^stm_session=[a-f0-9]{64}$/);

  const me = await request("GET", "/api/auth/me", { cookie: userA.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.payload.user.name, "Антон Бєлка");
});

test("2. Повторна реєстрація з тією самою адресою відхиляється", async () => {
  const response = await request("POST", "/api/auth/register", {
    body: { name: "Інший", email: "ANTON@example.com", password: "Password123", password_confirm: "Password123" },
  });
  assert.equal(response.status, 409);
  assert.equal(response.payload.fieldErrors.email, "Користувач із такою електронною адресою вже зареєстрований.");
});

test("3. Перевірка полів реєстрації: паролі, адреса, довжина пароля", async () => {
  const mismatch = await request("POST", "/api/auth/register", {
    body: { name: "Тест", email: "mismatch@example.com", password: "Password123", password_confirm: "Password124" },
  });
  assert.equal(mismatch.status, 422);
  assert.ok(mismatch.payload.fieldErrors.password_confirm);

  const badEmail = await request("POST", "/api/auth/register", {
    body: { name: "Тест", email: "not-an-email", password: "Password123", password_confirm: "Password123" },
  });
  assert.equal(badEmail.status, 422);
  assert.ok(badEmail.payload.fieldErrors.email);

  const shortPassword = await request("POST", "/api/auth/register", {
    body: { name: "Тест", email: "short@example.com", password: "short", password_confirm: "short" },
  });
  assert.equal(shortPassword.status, 422);
  assert.ok(shortPassword.payload.fieldErrors.password);
});

test("4. Вхід із правильним паролем і відмова при неправильному", async () => {
  const ok = await request("POST", "/api/auth/login", {
    body: { email: "anton@example.com", password: "Password123" },
  });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^stm_session=/);
  userA.cookie = ok.cookie;

  const wrong = await request("POST", "/api/auth/login", {
    body: { email: "anton@example.com", password: "WrongPassword" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.payload.error, "Неправильна електронна адреса або пароль.");
});

test("5. Після виходу захищені операції недоступні", async () => {
  const second = await request("POST", "/api/auth/login", {
    body: { email: "anton@example.com", password: "Password123" },
  });
  const tempCookie = second.cookie;

  const logout = await request("POST", "/api/auth/logout", { cookie: tempCookie });
  assert.equal(logout.status, 200);

  const tasks = await request("GET", "/api/tasks", { cookie: tempCookie });
  assert.equal(tasks.status, 401);

  const anonymous = await request("GET", "/api/tasks");
  assert.equal(anonymous.status, 401);
});

test("6. Створення завдання та відхилення порожньої назви", async () => {
  const created = await request("POST", "/api/tasks", {
    cookie: userA.cookie,
    body: {
      title: "  Практична робота №16  ",
      description: "Реалізувати MVP",
      deadline: "2026-11-14",
      priority: "high",
      category_id: 1,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.task.title, "Практична робота №16");
  assert.equal(created.payload.task.status, "active");
  assert.equal(created.payload.task.category, "Технологія створення програмних продуктів");

  const empty = await request("POST", "/api/tasks", {
    cookie: userA.cookie,
    body: { title: "   ", priority: "medium" },
  });
  assert.equal(empty.status, 422);
  assert.ok(empty.payload.fieldErrors.title);

  const badPriority = await request("POST", "/api/tasks", {
    cookie: userA.cookie,
    body: { title: "Завдання", priority: "critical" },
  });
  assert.equal(badPriority.status, 422);
  assert.ok(badPriority.payload.fieldErrors.priority);
});

test("7. Редагування всіх полів не створює дубліката", async () => {
  const list = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const task = list.payload.tasks[0];

  const updated = await request("PUT", `/api/tasks/${task.id}`, {
    cookie: userA.cookie,
    body: {
      title: "Практична робота №16 — MVP",
      description: "Реалізувати MVP і оновити README",
      deadline: "2026-11-15",
      priority: "medium",
      category_id: 2,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.task.id, task.id);
  assert.equal(updated.payload.task.title, "Практична робота №16 — MVP");
  assert.equal(updated.payload.task.description, "Реалізувати MVP і оновити README");
  assert.equal(updated.payload.task.deadline, "2026-11-15");
  assert.equal(updated.payload.task.priority, "medium");
  assert.equal(updated.payload.task.category, "Web-технології та web-дизайн");

  const after = await request("GET", "/api/tasks", { cookie: userA.cookie });
  assert.equal(after.payload.tasks.length, 1);
});

test("8. Зміна стану в обидва боки", async () => {
  const list = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const id = list.payload.tasks[0].id;

  const done = await request("PATCH", `/api/tasks/${id}`, { cookie: userA.cookie, body: { status: "done" } });
  assert.equal(done.status, 200);
  assert.equal(done.payload.task.status, "done");

  const active = await request("PATCH", `/api/tasks/${id}`, { cookie: userA.cookie, body: { status: "active" } });
  assert.equal(active.status, 200);
  assert.equal(active.payload.task.status, "active");

  const invalid = await request("PATCH", `/api/tasks/${id}`, { cookie: userA.cookie, body: { status: "archived" } });
  assert.equal(invalid.status, 422);
});

test("9. Пошук, фільтри та сортування працюють разом", async () => {
  const seed = [
    { title: "Практична робота №17", priority: "high", deadline: "2026-11-21", category_id: 1 },
    { title: "Практична робота №18", priority: "low", deadline: "2026-11-28", category_id: 1 },
    { title: "Підготувати презентацію", priority: "high", deadline: "2026-11-19", category_id: 3 },
  ];
  for (const body of seed) {
    const response = await request("POST", "/api/tasks", { cookie: userA.cookie, body });
    assert.equal(response.status, 201);
  }

  const list = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const first = list.payload.tasks.find((task) => task.title === "Практична робота №17");
  await request("PATCH", `/api/tasks/${first.id}`, { cookie: userA.cookie, body: { status: "done" } });

  const combined = await request(
    "GET",
    "/api/tasks?q=%D0%BF%D1%80%D0%B0%D0%BA%D1%82%D0%B8%D1%87%D0%BD%D0%B0&status=active&priority=high",
    { cookie: userA.cookie }
  );
  assert.equal(combined.payload.tasks.length, 0, "виконана ПР17 не має потрапляти у активні");

  const highActive = await request("GET", "/api/tasks?status=active&priority=high", { cookie: userA.cookie });
  assert.ok(highActive.payload.tasks.every((task) => task.priority === "high" && task.status === "active"));
  assert.ok(highActive.payload.tasks.some((task) => task.title === "Підготувати презентацію"));

  const byCategory = await request("GET", "/api/tasks?category=3", { cookie: userA.cookie });
  assert.equal(byCategory.payload.tasks.length, 1);

  const bySearch = await request("GET", "/api/tasks?q=%D0%BF%D1%80%D0%B5%D0%B7%D0%B5%D0%BD%D1%82", { cookie: userA.cookie });
  assert.equal(bySearch.payload.tasks.length, 1);

  const deadlineAsc = await request("GET", "/api/tasks?sort=deadline_asc", { cookie: userA.cookie });
  const dates = deadlineAsc.payload.tasks.map((task) => task.deadline).filter(Boolean);
  assert.deepEqual(dates, [...dates].sort());

  const priorityDesc = await request("GET", "/api/tasks?sort=priority_desc", { cookie: userA.cookie });
  const high = priorityDesc.payload.tasks.findIndex((task) => task.priority === "high");
  const low = priorityDesc.payload.tasks.findLastIndex((task) => task.priority === "low");
  assert.ok(high < low, "завдання з високим пріоритетом мають бути вище");
});

test("10. Видалення видаляє лише вибране завдання", async () => {
  const before = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const target = before.payload.tasks.find((task) => task.title === "Практична робота №18");

  const deleted = await request("DELETE", `/api/tasks/${target.id}`, { cookie: userA.cookie });
  assert.equal(deleted.status, 200);

  const after = await request("GET", "/api/tasks", { cookie: userA.cookie });
  assert.equal(after.payload.tasks.length, before.payload.tasks.length - 1);
  assert.ok(!after.payload.tasks.some((task) => task.id === target.id));

  const again = await request("DELETE", `/api/tasks/${target.id}`, { cookie: userA.cookie });
  assert.equal(again.status, 404);
});

test("11. Ізоляція даних двох користувачів, зокрема через прямі запити", async () => {
  userB = await registerUser({ name: "Марія Тестова", email: "maria@example.com", password: "Password456" });

  const listB = await request("GET", "/api/tasks", { cookie: userB.cookie });
  assert.equal(listB.payload.tasks.length, 0);

  const listA = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const foreign = listA.payload.tasks[0];

  const readForeign = await request("PUT", `/api/tasks/${foreign.id}`, {
    cookie: userB.cookie,
    body: { title: "Чуже завдання", priority: "low" },
  });
  assert.equal(readForeign.status, 404);

  const deleteForeign = await request("DELETE", `/api/tasks/${foreign.id}`, { cookie: userB.cookie });
  assert.equal(deleteForeign.status, 404);

  const toggleForeign = await request("PATCH", `/api/tasks/${foreign.id}`, {
    cookie: userB.cookie,
    body: { status: "done" },
  });
  assert.equal(toggleForeign.status, 404);

  const stillThere = await request("GET", "/api/tasks", { cookie: userA.cookie });
  assert.ok(stillThere.payload.tasks.some((task) => task.id === foreign.id && task.title === foreign.title));
});

test("12. Дані зберігаються після перезапуску застосунку", async () => {
  const before = await request("GET", "/api/tasks", { cookie: userA.cookie });
  const expected = before.payload.tasks.length;
  assert.ok(expected > 0);

  await app.close();

  await startApp(dbPath);
  const relogin = await request("POST", "/api/auth/login", {
    body: { email: "anton@example.com", password: "Password123" },
  });
  assert.equal(relogin.status, 200);

  const after = await request("GET", "/api/tasks", { cookie: relogin.cookie });
  assert.equal(after.payload.tasks.length, expected);
});

test("13. Пошук і сортування не залежать від регістру кирилиці", async () => {
  const created = await request("POST", "/api/tasks", {
    cookie: userA.cookie,
    body: { title: "Практична робота №19", priority: "low" },
  });
  assert.equal(created.status, 201);

  const search = await request("GET", `/api/tasks?q=${encodeURIComponent("практична")}`, {
    cookie: userA.cookie,
  });
  assert.ok(
    search.payload.tasks.some((task) => task.title === "Практична робота №19"),
    "пошук малими літерами має знаходити назву з великої літери"
  );

  const sorted = await request("GET", "/api/tasks?sort=title_asc", { cookie: userA.cookie });
  const titles = sorted.payload.tasks.map((task) => task.title.toLowerCase());
  assert.deepEqual(titles, [...titles].sort());
});
