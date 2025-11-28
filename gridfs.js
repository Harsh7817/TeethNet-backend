import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";

let gfsBucket;

export function getBucket() {
  if (!gfsBucket) {
    const db = mongoose.connection.db;
    gfsBucket = new GridFSBucket(db, { bucketName: "uploads" });
  }
  return gfsBucket;
}

// Store a file from local path into GridFS
export async function storeLocalFileToGridFS(localPath, filename, contentType = "application/octet-stream") {
  const bucket = getBucket();
  const fs = await import("fs");
  const read = fs.createReadStream(localPath);
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType });
    read.pipe(uploadStream)
      .on("error", reject)
      .on("finish", () => resolve(uploadStream.id));
  });
}

// Stream a GridFS file to Express response
export function streamGridFSFile(fileId, res) {
  const bucket = getBucket();
  try {
    const dl = bucket.openDownloadStream(fileId);
    dl.on("file", (f) => {
      if (f?.contentType) res.setHeader("Content-Type", f.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${f.filename || fileId.toString()}"`);
    });
    dl.on("error", (e) => {
      res.status(404).json({ error: "File not found" });
    });
    dl.pipe(res);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
}