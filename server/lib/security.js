"use strict";

const crypto = require("node:crypto");

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

/**
 * Хешує пароль алгоритмом scrypt (KDF, рекомендований OWASP для паролів).
 * Формат збереження: scrypt$N$r$p$salt$hash — параметри можна змінювати без міграції.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
    .toString("hex");
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 32 * 1024 * 1024,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { hashPassword, verifyPassword, createSessionId };
