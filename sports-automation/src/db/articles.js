import { getDb } from "./connect.js";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Insert an article if its URL is not already known. Returns true if a new row
 * was inserted, false if the URL already existed. The PRIMARY KEY on `url`
 * enforces the dedup guarantee — an already-seen story is silently ignored.
 */
export function upsertArticle(item) {
  const db = getDb();
  const now = nowIso();
  const publishedAt = item.publishedAt ? new Date(item.publishedAt).toISOString() : null;
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO articles
         (url, title, source, publishedAt, snippet, status, runId, createdAt, updatedAt)
       VALUES (@url, @title, @source, @publishedAt, @snippet, 'pending', NULL, @now, @now)`
    )
    .run({
      url: item.url,
      title: item.title,
      source: item.source,
      publishedAt,
      snippet: item.snippet || "",
      now
    });
  return result.changes > 0;
}

/**
 * Atomically claim the newest pending article: pick the most-recently-published
 * pending row and flip it to "processing" in a single transaction, then return
 * it. Returns null if nothing is pending. The transaction guarantees two ticks
 * can never grab the same article.
 */
export function claimNextPendingArticle() {
  const db = getDb();
  const claim = db.transaction(() => {
    const row = db
      .prepare(`SELECT * FROM articles WHERE status = 'pending' ORDER BY publishedAt DESC LIMIT 1`)
      .get();
    if (!row) return null;
    db.prepare(`UPDATE articles SET status = 'processing', updatedAt = ? WHERE url = ?`).run(
      nowIso(),
      row.url
    );
    return { ...row, status: "processing" };
  });
  return claim();
}

/** Set an article's status (and optionally the run that processed it). */
export function setArticleStatus(url, status, runId = null) {
  const db = getDb();
  db.prepare(`UPDATE articles SET status = ?, runId = ?, updatedAt = ? WHERE url = ?`).run(
    status,
    runId,
    nowIso(),
    url
  );
}

export function countArticlesByStatus(status) {
  const db = getDb();
  return db.prepare(`SELECT COUNT(*) AS n FROM articles WHERE status = ?`).get(status).n;
}

export function listArticles({ status, limit = 50 } = {}) {
  const db = getDb();
  const lim = Math.min(Number(limit) || 50, 200);
  if (status) {
    return db
      .prepare(`SELECT * FROM articles WHERE status = ? ORDER BY publishedAt DESC LIMIT ?`)
      .all(status, lim);
  }
  return db.prepare(`SELECT * FROM articles ORDER BY publishedAt DESC LIMIT ?`).all(lim);
}
