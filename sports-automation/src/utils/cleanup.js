import fs from "node:fs/promises";
import path from "node:path";
import logger from "./logger.js";

const OUTPUT_DIR = path.resolve("output");

/**
 * Delete output/<runId> folders older than retentionDays.
 * @param {number} retentionDays
 */
export async function cleanupOldOutput(retentionDays) {
  let entries;
  try {
    entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(OUTPUT_DIR, entry.name);
    const stat = await fs.stat(dirPath);
    if (stat.mtimeMs < cutoff) {
      await fs.rm(dirPath, { recursive: true, force: true });
      removed++;
      logger.info({ dir: entry.name }, "cleaned up old output folder");
    }
  }

  logger.info({ removed, retentionDays }, "cleanup pass complete");
}
