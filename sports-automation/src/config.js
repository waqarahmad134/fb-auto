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
  dbPath: process.env.DB_PATH || "./data/app.db",
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

  piper: {
    bin: process.env.PIPER_BIN,
    voice: process.env.PIPER_VOICE,
    lengthScale: num(process.env.PIPER_LENGTH_SCALE, 1.0)
  },

  youtube: {
    clientId: process.env.YT_CLIENT_ID,
    clientSecret: process.env.YT_CLIENT_SECRET,
    redirectUri: process.env.YT_REDIRECT_URI,
    privacyStatus: process.env.YT_PRIVACY_STATUS || "public"
  },

  facebook: {
    pageId: process.env.FB_PAGE_ID,
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    graphApiVersion: "v20.0"
  }
};

export default config;
