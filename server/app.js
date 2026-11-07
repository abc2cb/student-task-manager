"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { openDatabase } = require("./db");
const { hashPassword, verifyPassword, createSessionId } = require("./lib/security");

const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE = "stm_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message, fieldErrors = null) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/* ---------- HTTP-допоміжники ---------- */

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Запит завеликий"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return reject(new HttpError(400, "Тіло запиту має бути JSON-об’єктом"));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, "Некоректний JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(sessionId, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/* ---------- валідація ---------- */

const PRIORITIES = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["active", "done"]);
const SORTS = new Set(["created_desc", "deadline_asc", "deadline_desc", "priority_desc", "priority_asc", "title_asc"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Яіїєґ]{2,}$/;

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function validateRegistration(body) {
  const name = normalizeText(body.name);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const passwordConfirm = String(body.password_confirm ?? "");

  const errors = {};
  if (name.length < 2) errors.name = "Вкажіть ім’я (мінімум 2 символи).";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Вкажіть коректну електронну адресу.";
  if (password.length < 8) errors.password = "Пароль має містити щонайменше 8 символів.";
  if (password !== passwordConfirm) errors.password_confirm = "Паролі не збігаються.";

  return { data: { name, email, password }, errors };
}

function validateTask(body, db) {
  const title = normalizeText(body.title);
  const description = String(body.description ?? "").trim();
  const deadline = String(body.deadline ?? "").trim();
  const priority = String(body.priority ?? "medium");
  const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === ""
    ? null
    : Number(body.category_id);

  const errors = {};
  if (!title) errors.title = "Назва обов’язкова: поле не може бути порожнім або містити лише пробіли.";
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) errors.deadline = "Термін має бути датою у форматі РРРР-ММ-ДД.";
  if (!PRIORITIES.has(priority)) errors.priority = "Пріоритет має бути low, medium або high.";
  if (categoryId !== null && (!Number.isInteger(categoryId) || !db.categoryExists(categoryId))) {
    errors.category_id = "Вибраної дисципліни не існує.";
  }

  return { data: { title, description, deadline: deadline || null, priority, categoryId }, errors };
}

/* ---------- сервер ---------- */

function createApp({ dbPath = "data/task-manager.db", sessionTtlMs = SESSION_TTL_MS } = {}) {
  const db = openDatabase(dbPath);
  const startedAt = Date.now();

  function currentUser(req) {
    const { [SESSION_COOKIE]: sessionId } = parseCookies(req);
    if (!sessionId) return null;

    const session = db.findSession(sessionId);
    if (!session) return null;

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      db.deleteSession(sessionId);
      return null;
    }

    return { id: session.user_id, name: session.name, email: session.email, sessionId };
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "Потрібно увійти в обліковий запис.");
    return user;
  }

  function publicTask(task) {
    if (!task) return null;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      priority: task.priority,
      status: task.status,
      category_id: task.category_id,
      category: task.category ?? null,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  async function handleApi(req, res, url) {
    const segments = url.pathname.split("/").filter(Boolean); // ["api", ...]
    const method = req.method;

    if (segments[1] === "health" && method === "GET") {
      return sendJson(res, 200, { status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
    }

    if (segments[1] === "auth") {
      if (segments[2] === "register" && method === "POST") {
        const body = await readJsonBody(req);
        const { data, errors } = validateRegistration(body);
        if (Object.keys(errors).length) {
          throw new HttpError(422, "Перевірте заповнення полів.", errors);
        }

        if (db.findUserByEmail(data.email)) {
          throw new HttpError(409, "Користувач із такою електронною адресою вже зареєстрований.", {
            email: "Користувач із такою електронною адресою вже зареєстрований.",
          });
        }

        const user = db.createUser({
          name: data.name,
          email: data.email,
          passwordHash: hashPassword(data.password),
        });
        const sessionId = createSessionId();
        const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
        db.createSession({ id: sessionId, userId: user.id, expiresAt });

        return sendJson(
          res,
          201,
          { user: { id: user.id, name: user.name, email: user.email } },
          { "Set-Cookie": sessionCookie(sessionId, Math.floor(sessionTtlMs / 1000)) }
        );
      }

      if (segments[2] === "login" && method === "POST") {
        const body = await readJsonBody(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const record = db.findUserByEmail(email);

        if (!record || !verifyPassword(password, record.password_hash)) {
          throw new HttpError(401, "Неправильна електронна адреса або пароль.");
        }

        const sessionId = createSessionId();
        const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
        db.createSession({ id: sessionId, userId: record.id, expiresAt });

        return sendJson(
          res,
          200,
          { user: { id: record.id, name: record.name, email: record.email } },
          { "Set-Cookie": sessionCookie(sessionId, Math.floor(sessionTtlMs / 1000)) }
        );
      }

      if (segments[2] === "logout" && method === "POST") {
        const { [SESSION_COOKIE]: sessionId } = parseCookies(req);
        if (sessionId) db.deleteSession(sessionId);
        return sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
      }

      if (segments[2] === "me" && method === "GET") {
        const user = requireUser(req);
        return sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
      }
    }

    if (segments[1] === "categories" && method === "GET") {
      requireUser(req);
      return sendJson(res, 200, { categories: db.listCategories() });
    }

    if (segments[1] === "tasks") {
      const user = requireUser(req);

      if (segments.length === 2 && method === "GET") {
        const params = url.searchParams;
        const sort = params.get("sort") ?? "created_desc";
        const status = params.get("status") ?? "";
        const priority = params.get("priority") ?? "";

        return sendJson(res, 200, {
          tasks: db
            .listTasks(user.id, {
              search: normalizeText(params.get("q") ?? ""),
              status: STATUSES.has(status) ? status : "",
              priority: PRIORITIES.has(priority) ? priority : "",
              categoryId: params.get("category") ?? "",
              sort: SORTS.has(sort) ? sort : "created_desc",
            })
            .map(publicTask),
        });
      }

      if (segments.length === 2 && method === "POST") {
        const body = await readJsonBody(req);
        const { data, errors } = validateTask(body, db);
        if (Object.keys(errors).length) throw new HttpError(422, "Перевірте заповнення полів.", errors);
        return sendJson(res, 201, { task: publicTask(db.createTask(user.id, data)) });
      }

      const taskId = Number(segments[2]);
      if (!Number.isInteger(taskId) || taskId <= 0) throw new HttpError(404, "Завдання не знайдено.");

      if (segments.length === 3 && method === "PUT") {
        const body = await readJsonBody(req);
        const { data, errors } = validateTask(body, db);
        if (Object.keys(errors).length) throw new HttpError(422, "Перевірте заповнення полів.", errors);

        const task = db.updateTask(user.id, taskId, data);
        if (!task) throw new HttpError(404, "Завдання не знайдено.");
        return sendJson(res, 200, { task: publicTask(task) });
      }

      if (segments.length === 3 && method === "PATCH") {
        const body = await readJsonBody(req);
        const status = String(body.status ?? "");
        if (!STATUSES.has(status)) throw new HttpError(422, "Стан має бути active або done.", { status: "Некоректний стан." });

        const task = db.setTaskStatus(user.id, taskId, status);
        if (!task) throw new HttpError(404, "Завдання не знайдено.");
        return sendJson(res, 200, { task: publicTask(task) });
      }

      if (segments.length === 3 && method === "DELETE") {
        if (!db.deleteTask(user.id, taskId)) throw new HttpError(404, "Завдання не знайдено.");
        return sendJson(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, "Маршрут не знайдено.");
  }

  function serveStatic(req, res, url) {
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(PUBLIC_DIR, path.normalize(requested).replace(/^(\.\.[/\\])+/, ""));

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (req.headers.accept?.includes("text/html") && !path.extname(filePath)) {
          fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexError, indexContent) => {
            if (indexError) {
              res.writeHead(404).end("Not found");
              return;
            }
            res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
            res.end(indexContent);
          });
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      res.end(content);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw new HttpError(405, "Метод не підтримується.");
      }
      serveStatic(req, res, url);
    } catch (error) {
      if (error instanceof HttpError) {
        const payload = { error: error.message };
        if (error.fieldErrors) payload.fieldErrors = error.fieldErrors;
        sendJson(res, error.status, payload);
        return;
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      console.error("Помилка обробки запиту:", error);
      sendJson(res, 500, { error: "Внутрішня помилка сервера. Спробуйте пізніше." });
    }
  });

  return {
    server,
    db,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, "data", "task-manager.db");
  const { server, close } = createApp({ dbPath });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Student Task Manager: http://127.0.0.1:${port}`);
    console.log(`База даних: ${path.resolve(dbPath)}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      close().finally(() => process.exit(0));
    });
  }
}

module.exports = { createApp };
