import path from "node:path";
import fs from "node:fs";
import express from "express";
import Run from "../db/models/Run.js";
import Article from "../db/models/Article.js";
import { runPipeline } from "../pipeline/run.js";
import logger from "../utils/logger.js";

const OUTPUT_DIR = path.resolve("output");
const PUBLIC_DIR = path.resolve("src/admin/public");
const MEDIA_FILES = new Set(["background.png", "voice.wav", "subs.srt", "final.mp4", "content.json"]);

export function createAdminServer() {
  const app = express();
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/stats", async (req, res) => {
    const [byStatus, pendingArticles] = await Promise.all([
      Run.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Article.countDocuments({ status: "pending" })
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    res.json({ runs: counts, pendingArticles });
  });

  app.get("/api/runs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const runs = await Run.find().sort({ startedAt: -1 }).limit(limit).lean();
    res.json(runs);
  });

  app.get("/api/runs/:runId", async (req, res) => {
    const run = await Run.findOne({ runId: req.params.runId }).lean();
    if (!run) return res.status(404).json({ error: "run not found" });

    const runDir = path.join(OUTPUT_DIR, req.params.runId);
    const artifacts = {};
    for (const name of MEDIA_FILES) {
      if (fs.existsSync(path.join(runDir, name))) {
        artifacts[name] = `/media/${req.params.runId}/${name}`;
      }
    }
    res.json({ ...run, artifacts });
  });

  app.get("/media/:runId/:filename", (req, res) => {
    const { runId, filename } = req.params;
    if (!MEDIA_FILES.has(filename) || /[\\/]/.test(runId)) {
      return res.status(400).end();
    }
    const filePath = path.join(OUTPUT_DIR, runId, filename);
    if (!filePath.startsWith(OUTPUT_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).end();
    }
    res.sendFile(filePath);
  });

  app.get("/api/articles", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const filter = req.query.status ? { status: req.query.status } : {};
    const articles = await Article.find(filter).sort({ publishedAt: -1 }).limit(limit).lean();
    res.json(articles);
  });

  app.post("/api/trigger", (req, res) => {
    logger.info("admin: manual run triggered");
    runPipeline().catch((err) => logger.error({ err: err.message }, "manually triggered run failed"));
    res.status(202).json({ triggered: true });
  });

  return app;
}

export function startAdminServer(port) {
  const app = createAdminServer();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info({ port }, "admin panel listening");
      resolve(server);
    });
  });
}
