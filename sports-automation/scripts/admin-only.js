// Starts only the admin dashboard + database, skipping ffmpeg/Ollama/Piper
// dep checks and the cron scheduler. Useful for browsing run history and the article
// queue while the rest of the stack is still being set up.
import config from "../src/config.js";
import { connectDb } from "../src/db/connect.js";
import { startAdminServer } from "../src/admin/server.js";
import logger from "../src/utils/logger.js";

async function main() {
  await connectDb();
  await startAdminServer(config.adminPort);
  logger.info({ url: `http://localhost:${config.adminPort}` }, "admin panel available (standalone mode, no cron)");
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "admin-only startup failed");
  process.exit(1);
});
