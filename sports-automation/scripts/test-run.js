import { runDepChecks } from "./check-deps.js";
import { connectDb, disconnectDb } from "../src/db/connect.js";
import { runPipeline } from "../src/pipeline/run.js";
import logger from "../src/utils/logger.js";

async function main() {
  logger.info("test-run: checking dependencies");
  await runDepChecks({ exitOnFailure: true });

  logger.info("test-run: connecting to MongoDB");
  await connectDb();

  logger.info("test-run: running pipeline once");
  await runPipeline();

  logger.info("test-run: complete");
  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "test-run failed");
  process.exit(1);
});
