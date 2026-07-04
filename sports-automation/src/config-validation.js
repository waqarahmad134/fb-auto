// Pure validation logic, isolated from config.js so it can be unit-tested
// without triggering config.js's module-load-time process.exit(1) side effect.

// Always required, regardless of DRY_RUN.
// (DB_PATH is intentionally omitted — it has a sane default of ./data/app.db.)
export const ALWAYS_REQUIRED = [
  "RSS_FEEDS",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "POLLINATIONS_BASE_URL",
  "PIPER_BIN",
  "PIPER_VOICE"
];

// Only required for a real (non-dry-run) publish.
export const PUBLISH_REQUIRED = [
  "YT_CLIENT_ID",
  "YT_CLIENT_SECRET",
  "YT_REDIRECT_URI",
  "FB_PAGE_ID",
  "FB_PAGE_ACCESS_TOKEN"
];

/** Given an env object and dryRun flag, return the list of missing required keys. */
export function getMissingRequiredVars(env, dryRun) {
  const missing = ALWAYS_REQUIRED.filter((key) => !env[key]);
  if (!dryRun) {
    missing.push(...PUBLISH_REQUIRED.filter((key) => !env[key]));
  }
  return missing;
}
