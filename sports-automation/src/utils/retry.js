import logger from "./logger.js";

/**
 * Generic retry with exponential backoff.
 * @param {() => Promise<any>} fn - async function to attempt
 * @param {object} opts
 * @param {number} [opts.attempts=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {string} [opts.label="operation"]
 * @param {(attempt: number, error: Error) => void} [opts.onRetry] - called before each retry, e.g. to vary a seed
 */
export async function retry(fn, opts = {}) {
  const { attempts = 3, baseDelayMs = 1000, label = "operation", onRetry } = opts;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      logger.warn({ label, attempt, attempts, err: err.message }, `${label} failed (attempt ${attempt}/${attempts})`);
      if (attempt < attempts) {
        if (onRetry) onRetry(attempt, err);
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
