import fs from "node:fs";
import path from "node:path";
import pino from "pino";

const LOG_DIR = path.resolve("logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const isDev = process.env.NODE_ENV !== "production";

const targets = [
  {
    target: "pino/file",
    options: { destination: path.join(LOG_DIR, "app.log"), mkdir: true },
    level: "info"
  }
];

if (isDev) {
  targets.push({
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:standard" },
    level: "debug"
  });
}

const logger = pino(
  { level: isDev ? "debug" : "info" },
  pino.transport({ targets })
);

export default logger;
