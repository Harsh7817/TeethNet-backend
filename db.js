import mongoose from "mongoose";

export async function connectMongo(uri) {
  if (!uri) throw new Error("MONGODB_URI is required");
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 20000
  });
  return mongoose.connection;
}