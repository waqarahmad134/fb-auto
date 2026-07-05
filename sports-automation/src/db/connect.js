import fs from "node:fs/promises";
import path from "node:path";
import config from "../config.js";
import logger from "../utils/logger.js";

const DATA_DIR = path.resolve(config.dataDir);

/** All state lives in local JSON files under DATA_DIR — this just ensures the directory exists. */
export async function connectDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  logger.info({ dataDir: DATA_DIR }, "local JSON data store ready");
}

export async function disconnectDb() {
  // no persistent connection to close for the local JSON store
}
