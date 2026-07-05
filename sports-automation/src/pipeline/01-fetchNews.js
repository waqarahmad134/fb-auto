import Parser from "rss-parser";
import config from "../config.js";
import logger from "../utils/logger.js";
import { upsertNewArticles, selectNextPending } from "../db/articleStore.js";

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }]
    ]
  }
});

/** Pull an image URL straight out of the RSS item, if the feed provides one (enclosure or Media RSS tags). */
function extractRssImageUrl(item) {
  if (item.enclosure?.url && (!item.enclosure.type || item.enclosure.type.startsWith("image/"))) {
    return item.enclosure.url;
  }
  const media = item.mediaContent?.[0]?.$ || item.mediaThumbnail?.[0]?.$;
  return media?.url || null;
}

async function fetchFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return (feed.items || []).map((item) => ({
      url: item.link,
      title: item.title?.trim() || "",
      source: feed.title || feedUrl,
      publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
      snippet: (item.contentSnippet || item.content || "").trim().slice(0, 1000),
      imageUrl: extractRssImageUrl(item)
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

  const newCount = await upsertNewArticles(items);
  const nextArticle = await selectNextPending();

  logger.info({ fetched: items.length, newCount, selected: nextArticle?.url || null }, "step 01: fetch news complete");

  return { article: nextArticle, newCount };
}
