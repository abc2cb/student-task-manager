#!/usr/bin/env node
"use strict";

/**
 * Створює структуру бази даних і довідник дисциплін.
 * Запуск: npm run init-db
 */

const path = require("node:path");
const { openDatabase } = require("../db");

const dbPath = process.env.DB_PATH ?? path.join(__dirname, "..", "data", "task-manager.db");
const db = openDatabase(dbPath);

const categories = db.listCategories();
console.log(`База даних готова: ${path.resolve(dbPath)}`);
console.log(`Довідник дисциплін: ${categories.length} записів`);
db.close();
