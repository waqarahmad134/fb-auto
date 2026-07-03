import Parser from "rss-parser";
import config from "../config.js";
import logger from "../utils/logger.js";
import Article from "../db/models/Article.js";

const parser = new Parser({ timeout: 15000 });

async function fetchFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return (feed.items || []).map((item) => ({
      url: item.link,
      title: item.title?.trim() || "",
      source: feed.title || feedUrl,
      publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
      snippet: (item.contentSnippet || item.content || "").trim().slice(0, 1000)
    }));
  } catch (err) {
    logger.warn({ feedUrl, err: err.message }, "RSS feed failed — skipping this feed");
    return [];
  }
}

/**
 * Fetch all configured RSS feeds, upsert new articles as "pending",
 * then select and lock the newest pending article for processing.
 * @returns {Promise<{ article: object|null, newCount: number }>}
 */
export async function fetchNews() {
  const feedResults = await Promise.all(config.rssFeeds.map(fetchFeed));
  const items = feedResults.flat().filter((item) => item.url && item.title);

  let newCount = 0;
  for (const item of items) {
    const result = await Article.updateOne(
      { url: item.url },
      { $setOnInsert: { ...item, status: "pending" } },
      { upsert: true }
    );
    if (result.upsertedCount > 0) newCount++;
  }

  const nextArticle = await Article.findOneAndUpdate(
    { status: "pending" },
    { $set: { status: "processing" } },
    { sort: { publishedAt: -1 }, new: true }
  );

  logger.info({ fetched: items.length, newCount, selected: nextArticle?.url || null }, "step 01: fetch news complete");

  return { article: nextArticle, newCount };
}
