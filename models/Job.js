import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    // GridFS file ids
    imageFileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    stlFileId: { type: mongoose.Schema.Types.ObjectId },
    // paths in shared volume (optional)
    sourcePath: { type: String },
    resultPath: { type: String },
    // celery job id
    jobId: { type: String, required: true, index: true },
    status: { type: String, enum: ["QUEUED", "RUNNING", "SUCCESS", "FAILURE"], default: "QUEUED" },
    error: { type: String },
    // optional knob snapshot
    params: { type: Object, default: {} }
  },
  { timestamps: true }
);

export const Job = mongoose.model("Job", jobSchema);