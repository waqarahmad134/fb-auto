import mongoose from "mongoose";

const articleSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    source: { type: String, required: true },
    publishedAt: { type: Date },
    snippet: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending"
    },
    runId: { type: String, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("Article", articleSchema);
