import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { User } from "./models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export async function signup(req, res) {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: "email already registered" });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash, name });
    const token = jwt.sign({ sub: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, email, name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });
    const token = jwt.sign({ sub: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, email, name: user.name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.substring(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}