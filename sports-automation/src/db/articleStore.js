import path from "node:path";
import config from "../config.js";
import { createJsonFile } from "./jsonFile.js";

const file = createJsonFile(path.resolve(config.dataDir, "articles.json"), []);

/** Insert any items whose url isn't already known, as status "pending". Returns count inserted. */
export async function upsertNewArticles(items) {
  return file.mutate((articles) => {
    const existingUrls = new Set(articles.map((a) => a.url));
    let newCount = 0;
    for (const item of items) {
      if (existingUrls.has(item.url)) continue;
      articles.push({ ...item, status: "pending", runId: null, createdAt: new Date().toISOString() });
      existingUrls.add(item.url);
      newCount++;
    }
    return newCount;
  });
}

/** Pick the newest "pending" article, mark it "processing", and return it (or null if none). */
export async function selectNextPending() {
  return file.mutate((articles) => {
    const pending = articles.filter((a) => a.status === "pending");
    if (pending.length === 0) return null;
    pending.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const chosen = pending[0];
    chosen.status = "processing";
    return { ...chosen };
  });
}

export async function getArticleByUrl(url) {
  const articles = await file.read();
  return articles.find((a) => a.url === url) || null;
}

export async function markArticleStatus(url, status, extra = {}) {
  await file.mutate((articles) => {
    const article = articles.find((a) => a.url === url);
    if (article) Object.assign(article, { status, ...extra });
  });
}

export async function listArticles({ status, limit = 50 } = {}) {
  const articles = await file.read();
  const filtered = status ? articles.filter((a) => a.status === status) : articles;
  return [...filtered].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, limit);
}

export async function countArticlesByStatus(status) {
  const articles = await file.read();
  return articles.filter((a) => a.status === status).length;
}
