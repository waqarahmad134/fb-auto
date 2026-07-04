import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import config from "../config.js";
import logger from "../utils/logger.js";

let db = null;

// Two tables hold all pipeline state (articles queue + run history). Dates are
// stored as ISO 8601 strings (UTC) — same lexical order as chronological order,
// so ORDER BY works directly. stepResults is a JSON array serialized to text.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  url         TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL,
  publishedAt TEXT,
  snippet     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  runId       TEXT,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_status_published
  ON articles (status, publishedAt DESC);

CREATE TABLE IF NOT EXISTS runs (
  runId           TEXT PRIMARY KEY,
  articleUrl      TEXT,
  startedAt       TEXT NOT NULL,
  finishedAt      TEXT,
  status          TEXT NOT NULL DEFAULT 'running',
  stepResults     TEXT NOT NULL DEFAULT '[]',
  error           TEXT,
  youtubeVideoId  TEXT,
  facebookVideoId TEXT,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs (startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs (status);
`;

export async function connectDb() {
  if (db) return db;
  const dbPath = config.dbPath;
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL"); // concurrent reads (admin panel) while a run writes
  db.exec(SCHEMA);
  logger.info({ dbPath }, "opened SQLite database");
  return db;
}

export function getDb() {
  if (!db) throw new Error("database not initialized — call connectDb() first");
  return db;
}

export async function disconnectDb() {
  if (db) {
    db.close();
    db = null;
  }
}
