import cron from "node-cron";
import config from "./config.js";
import logger from "./utils/logger.js";
import { runDepChecks } from "../scripts/check-deps.js";
import { connectDb, disconnectDb } from "./db/connect.js";
import Run from "./db/models/Run.js";
import { runPipeline } from "./pipeline/run.js";
import { cleanupOldOutput } from "./utils/cleanup.js";
import { startAdminServer } from "./admin/server.js";

const STALE_RUN_MINUTES = 45;
let adminServer = null;

async function recoverStaleRuns() {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000);
  const result = await Run.updateMany(
    { status: "running", startedAt: { $lt: cutoff } },
    { $set: { status: "failed", error: "stale run recovered at startup", finishedAt: new Date() } }
  );
  if (result.modifiedCount > 0) {
    logger.warn({ count: result.modifiedCount }, "recovered stale running run(s) as failed");
  }
}

async function main() {
  logger.info({ nodeEnv: config.nodeEnv, dryRun: config.dryRun }, "starting sports-automation");

  const deps = await runDepChecks({ exitOnFailure: true });
  logger.info({ deps: deps.results.map((r) => r.name) }, "dependency checks passed");

  await connectDb();
  await recoverStaleRuns();

  cron.schedule(config.cronSchedule, async () => {
    try {
      await runPipeline();
    } catch (err) {
      // runPipeline already sandboxes its own errors; this is a last-resort net
      // so a bug in the orchestrator itself can never crash the cron loop.
      logger.error({ err: err.message, stack: err.stack }, "unhandled error escaped runPipeline");
    }
  });
  logger.info({ schedule: config.cronSchedule }, "pipeline cron registered");

  cron.schedule("0 3 * * *", async () => {
    try {
      await cleanupOldOutput(config.outputRetentionDays);
    } catch (err) {
      logger.error({ err: err.message }, "cleanup cron failed");
    }
  });
  logger.info("cleanup cron registered (daily 03:00)");

  adminServer = await startAdminServer(config.adminPort);
  logger.info({ url: `http://localhost:${config.adminPort}` }, "admin panel available");

  logger.info("scheduler armed");
}

async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  try {
    if (adminServer) await new Promise((resolve) => adminServer.close(resolve));
    await disconnectDb();
  } catch (err) {
    logger.error({ err: err.message }, "error during shutdown");
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "fatal startup error");
  process.exit(1);
});
