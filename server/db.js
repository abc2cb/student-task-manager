"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_PATH = path.join(__dirname, "db", "schema.sql");

/**
 * Відкриває базу даних і застосовує схему (idempotent).
 * @param {string} dbPath шлях до файлу SQLite або ":memory:"
 */
function openDatabase(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  // SQLite lower() змінює регістр лише для ASCII, тому для кирилиці
  // реєстронезалежний пошук і сортування виконує JavaScript-функція.
  db.function("uk_lower", { deterministic: true }, (value) => String(value ?? "").toLowerCase());
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return new DatabaseSyncQueries(db);
}

/**
 * Обгортка з підготовленими запитами, щоб SQL не розходився по всьому серверу.
 */
class DatabaseSyncQueries {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  /* ---------- користувачі ---------- */

  createUser({ name, email, passwordHash }) {
    const result = this.db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, passwordHash);
    return this.findUserById(Number(result.lastInsertRowid));
  }

  findUserByEmail(email) {
    return this.db
      .prepare("SELECT id, name, email, password_hash, created_at FROM users WHERE email = ?")
      .get(email);
  }

  findUserById(id) {
    return this.db
      .prepare("SELECT id, name, email, created_at FROM users WHERE id = ?")
      .get(id);
  }

  /* ---------- сесії ---------- */

  createSession({ id, userId, expiresAt }) {
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(id, userId, expiresAt);
  }

  findSession(id) {
    return this.db
      .prepare(
        `SELECT s.id, s.expires_at, u.id AS user_id, u.name, u.email
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`
      )
      .get(id);
  }

  deleteSession(id) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions(nowIso) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso);
  }

  /* ---------- категорії ---------- */

  listCategories() {
    return this.db.prepare("SELECT id, name FROM categories ORDER BY name").all();
  }

  categoryExists(id) {
    return Boolean(this.db.prepare("SELECT 1 AS ok FROM categories WHERE id = ?").get(id));
  }

  /* ---------- завдання ---------- */

  listTasks(userId, { search = "", status = "", priority = "", categoryId = "", sort = "created_desc" } = {}) {
    const clauses = ["t.user_id = ?"];
    const params = [userId];

    if (search) {
      clauses.push("uk_lower(t.title) LIKE uk_lower(?)");
      params.push(`%${search}%`);
    }
    if (status) {
      clauses.push("t.status = ?");
      params.push(status);
    }
    if (priority) {
      clauses.push("t.priority = ?");
      params.push(priority);
    }
    if (categoryId) {
      clauses.push("t.category_id = ?");
      params.push(Number(categoryId));
    }

    const orderBy = {
      created_desc: "t.created_at DESC, t.id DESC",
      deadline_asc: "t.deadline IS NULL, t.deadline ASC, t.id DESC",
      deadline_desc: "t.deadline IS NULL, t.deadline DESC, t.id DESC",
      priority_desc:
        "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.deadline IS NULL, t.deadline ASC",
      priority_asc:
        "CASE t.priority WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.deadline IS NULL, t.deadline ASC",
      title_asc: "uk_lower(t.title) ASC",
    }[sort] ?? "t.created_at DESC, t.id DESC";

    return this.db
      .prepare(
        `SELECT t.id, t.user_id, t.category_id, c.name AS category, t.title, t.description,
                t.deadline, t.priority, t.status, t.created_at, t.updated_at
           FROM tasks t
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY ${orderBy}`
      )
      .all(...params);
  }

  getTask(userId, id) {
    return this.db
      .prepare(
        `SELECT t.id, t.user_id, t.category_id, c.name AS category, t.title, t.description,
                t.deadline, t.priority, t.status, t.created_at, t.updated_at
           FROM tasks t
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.id = ? AND t.user_id = ?`
      )
      .get(id, userId);
  }

  createTask(userId, data) {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (user_id, category_id, title, description, deadline, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(userId, data.categoryId, data.title, data.description, data.deadline, data.priority);
    return this.getTask(userId, Number(result.lastInsertRowid));
  }

  updateTask(userId, id, data) {
    const result = this.db
      .prepare(
        `UPDATE tasks
            SET category_id = ?, title = ?, description = ?, deadline = ?, priority = ?,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`
      )
      .run(data.categoryId, data.title, data.description, data.deadline, data.priority, id, userId);
    return result.changes > 0 ? this.getTask(userId, id) : null;
  }

  setTaskStatus(userId, id, status) {
    const result = this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(status, id, userId);
    return result.changes > 0 ? this.getTask(userId, id) : null;
  }

  deleteTask(userId, id) {
    const result = this.db
      .prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return result.changes > 0;
  }
}

module.exports = { openDatabase };
