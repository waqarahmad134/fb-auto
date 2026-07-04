import { getDb } from "./connect.js";

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** True if any run is still marked "running" — the DB half of the concurrency lock. */
export function anyRunning() {
  const db = getDb();
  return !!db.prepare(`SELECT 1 FROM runs WHERE status = 'running' LIMIT 1`).get();
}

export function createRun({ runId, startedAt, status = "running" }) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO runs (runId, startedAt, status, stepResults, createdAt, updatedAt)
     VALUES (?, ?, ?, '[]', ?, ?)`
  ).run(runId, toIso(startedAt), status, now, now);
}

/** Append one step-result object to a run's stepResults JSON array. */
export function appendStepResult(runId, step) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT stepResults FROM runs WHERE runId = ?`).get(runId);
    const steps = row ? JSON.parse(row.stepResults) : [];
    steps.push(step);
    db.prepare(`UPDATE runs SET stepResults = ?, updatedAt = ? WHERE runId = ?`).run(
      JSON.stringify(steps),
      nowIso(),
      runId
    );
  });
  tx();
}

// Columns updateRun is allowed to patch — guards against arbitrary keys reaching SQL.
const RUN_COLUMNS = new Set([
  "articleUrl",
  "finishedAt",
  "status",
  "error",
  "youtubeVideoId",
  "facebookVideoId"
]);

export function updateRun(runId, fields) {
  const db = getDb();
  const keys = Object.keys(fields).filter((k) => RUN_COLUMNS.has(k));
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = @${k}`).join(", ");
  const params = { runId, updatedAt: nowIso() };
  for (const k of keys) {
    const v = fields[k];
    params[k] = k === "finishedAt" ? toIso(v) : v === undefined ? null : v;
  }
  db.prepare(`UPDATE runs SET ${setSql}, updatedAt = @updatedAt WHERE runId = @runId`).run(params);
}

/** Mark any run stuck in "running" since before cutoffIso as failed. Returns count. */
export function recoverStaleRuns(cutoffIso) {
  const db = getDb();
  const now = nowIso();
  const result = db
    .prepare(
      `UPDATE runs
         SET status = 'failed', error = 'stale run recovered at startup',
             finishedAt = ?, updatedAt = ?
       WHERE status = 'running' AND startedAt < ?`
    )
    .run(now, now, cutoffIso);
  return result.changes;
}

function parseRun(row) {
  if (!row) return null;
  return { ...row, stepResults: JSON.parse(row.stepResults || "[]") };
}

export function runStatusCounts() {
  const db = getDb();
  const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM runs GROUP BY status`).all();
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

export function listRuns(limit = 20) {
  const db = getDb();
  const lim = Math.min(Number(limit) || 20, 100);
  return db.prepare(`SELECT * FROM runs ORDER BY startedAt DESC LIMIT ?`).all(lim).map(parseRun);
}

export function getRun(runId) {
  const db = getDb();
  return parseRun(db.prepare(`SELECT * FROM runs WHERE runId = ?`).get(runId));
}
