import mongoose from "mongoose";

const stepResultSchema = new mongoose.Schema(
  {
    step: { type: String, required: true },
    ok: { type: Boolean, required: true },
    durationMs: { type: Number, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const runSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    articleUrl: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["running", "success", "partial_success", "failed", "no_new_content"],
      default: "running"
    },
    stepResults: { type: [stepResultSchema], default: [] },
    error: { type: String, default: null },
    youtubeVideoId: { type: String, default: null },
    facebookVideoId: { type: String, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("Run", runSchema);
