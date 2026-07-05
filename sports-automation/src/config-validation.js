// Pure validation logic, isolated from config.js so it can be unit-tested
// without triggering config.js's module-load-time process.exit(1) side effect.

// Always required, regardless of DRY_RUN.
export const ALWAYS_REQUIRED = [
  "RSS_FEEDS",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "POLLINATIONS_BASE_URL",
  "PIPER_BIN",
  "PIPER_VOICE"
];

// Only required for a real (non-dry-run) publish. Facebook credentials are
// deliberately NOT listed here — if they're missing, step 08 skips gracefully at
// runtime instead of failing startup (see src/pipeline/08-postFacebook.js).
export const PUBLISH_REQUIRED = [];

/** Given an env object and dryRun flag, return the list of missing required keys. */
export function getMissingRequiredVars(env, dryRun) {
  const missing = ALWAYS_REQUIRED.filter((key) => !env[key]);
  if (!dryRun) {
    missing.push(...PUBLISH_REQUIRED.filter((key) => !env[key]));
  }
  return missing;
}
