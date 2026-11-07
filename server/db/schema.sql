-- Схема бази даних Student Task Manager (розширена версія).
-- Застосовується командою: npm run init-db

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT    NOT NULL DEFAULT '',
  deadline    TEXT,
  priority    TEXT    NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low', 'medium', 'high')),
  status      TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'done')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (user_id, status);

-- Довідник дисциплін. Категорії спільні для всіх користувачів.
INSERT OR IGNORE INTO categories (name) VALUES
  ('Технологія створення програмних продуктів'),
  ('Web-технології та web-дизайн'),
  ('Тестування програмних систем'),
  ('Англійська мова'),
  ('Інше');
