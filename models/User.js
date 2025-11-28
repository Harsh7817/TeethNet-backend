import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);