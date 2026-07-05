import dotenv from "dotenv";
import { getMissingRequiredVars } from "./config-validation.js";

dotenv.config();

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function num(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const DRY_RUN = bool(process.env.DRY_RUN, false);

function validate() {
  const missing = getMissingRequiredVars(process.env, DRY_RUN);
  if (missing.length > 0) {
    console.error("Missing required environment variables:\n" + missing.map((k) => `  - ${k}`).join("\n"));
    console.error("\nCopy .env.example to .env and fill in the values.");
    process.exit(1);
  }
}

validate();

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  dryRun: DRY_RUN,
  cronSchedule: process.env.CRON_SCHEDULE || "0 */4 * * *",
  dataDir: process.env.DATA_DIR || "./data",
  outputRetentionDays: num(process.env.OUTPUT_RETENTION_DAYS, 3),
  adminPort: num(process.env.ADMIN_PORT, 4321),

  rssFeeds: list(process.env.RSS_FEEDS),

  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL,
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 120000)
  },

  pollinations: {
    baseUrl: process.env.POLLINATIONS_BASE_URL,
    width: num(process.env.IMAGE_WIDTH, 768),
    height: num(process.env.IMAGE_HEIGHT, 1344)
  },

  // Use the real photo from the source article/RSS feed as the background when
  // available, before falling back to an AI-generated image. NOTE: real news photos
  // show identifiable people and team crests/logos, and are typically licensed to
  // the publication, not you — this carries real copyright/publicity-rights risk.
  // Default false: always generate an original AI image instead, informed by the
  // article's context but never reproducing the real photo/branding/logos.
  useArticleImage: bool(process.env.USE_ARTICLE_IMAGE, true),

  // Font used for the on-screen headline/subtext graphic overlay (step 06).
  fontPath: process.env.FONT_PATH || "./assets/fonts/Anton-Regular.ttf",

  piper: {
    bin: process.env.PIPER_BIN,
    voice: process.env.PIPER_VOICE,
    lengthScale: num(process.env.PIPER_LENGTH_SCALE, 1.0)
  },

  facebook: {
    pageId: process.env.FB_PAGE_ID,
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    graphApiVersion: "v20.0"
  }
};

export default config;
