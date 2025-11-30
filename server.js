const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors'); // ADD: CORS
require('dotenv').config();

// DO NOT change Python generation flow
const PYTHON_URL = process.env.PYTHON_URL || 'http://python-api:8000';

// Mongo / Auth config
const MONGODB_URI = process.env.MONGODB_URI || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Express + uploads (local temp; forwarded to Python and stored in Mongo)
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors({ origin: true, credentials: true })); // ADD: CORS allowed for all origins (Vercel + Localhost)

const upload = multer({ dest: 'uploads/' });

// Helper for retry
async function fetchWithRetry(url, options, retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`[Retry] Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ---------------- Mongo connection, models, GridFS ----------------
let gfsBucket = null;

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, index: true, required: true },
  passwordHash: { type: String, required: true },
  name: String
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  imageFileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  stlFileId: { type: mongoose.Schema.Types.ObjectId },
  sourceFilename: String,
  jobId: { type: String, required: true, index: true },
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'], default: 'QUEUED' },
  error: String,
  params: { type: Object, default: {} }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);

async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn('[Mongo] MONGODB_URI not set. DB features disabled.');
    return;
  }
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  gfsBucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  console.log('[Mongo] Connected and GridFS bucket ready');
}

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

async function storeLocalFileToGridFS(localPath, filename, contentType = 'application/octet-stream') {
  if (!gfsBucket) throw new Error('GridFS not initialized');
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(localPath);
    const up = gfsBucket.openUploadStream(filename, { contentType });
    read.pipe(up)
      .on('error', reject)
      .on('finish', () => resolve(up.id));
  });
}

function streamGridFSFile(fileId, res) {
  if (!gfsBucket) return res.status(503).json({ error: 'storage unavailable' });
  try {
    const id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
    const dl = gfsBucket.openDownloadStream(id);
    dl.on('file', f => {
      if (f?.contentType) res.setHeader('Content-Type', f.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${f.filename || id.toString()}"`);
    });
    dl.on('error', () => res.status(404).json({ error: 'file not found' }));
    dl.pipe(res);
  } catch {
    res.status(400).json({ error: 'invalid file id' });
  }
}

// ---------------- Auth routes ----------------
app.post('/auth/signup', async (req, res) => {
  try {
    await connectMongo();
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash, name });
    const token = jwt.sign({ sub: user._id.toString(), email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, email, name: user.name || '' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    await connectMongo();
    const { email, password } = req.body || {};
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = jwt.sign({ sub: user._id.toString(), email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, email, name: user.name || '' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- Job submission (store 2D image + forward to Python) ----------------
app.post('/submit', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    await connectMongo();

    const filePath = req.file.path;           // local temp path (node container)
    const origName = req.file.originalname || path.basename(filePath);
    const contentType = req.file.mimetype || 'image/jpeg';

    // 1) Store the 2D image in Mongo GridFS
    let imageFileId = null;
    if (gfsBucket) {
      imageFileId = await storeLocalFileToGridFS(filePath, origName, contentType);
    }

    // 2) Forward to Python API (multipart), DO NOT change Python flow
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), origName);

    // Use fetchWithRetry to handle cold starts
    const response = await fetchWithRetry(`${PYTHON_URL}/upload/`, {
      method: 'POST',
      data: form,
      headers: { ...form.getHeaders() },
      timeout: 120000
    }, 5, 3000);

    // remove local temp file
    fs.unlink(filePath, () => { });

    const { job_id, result } = response.data || {};

    // 3) Save a Job record linked to this user (if DB available)
    let jobDoc = null;
    if (gfsBucket && imageFileId) {
      jobDoc = await Job.create({
        userId: req.user.id,
        imageFileId,
        jobId: job_id,
        status: 'QUEUED',
        sourceFilename: origName
      });
    }

    return res.json({
      job_id,
      db_job_id: jobDoc ? jobDoc._id : null,
      result: result || null
    });
  } catch (err) {
    console.error(err.toString());
    return res.status(500).json({ error: 'Failed to submit job', detail: err.toString() });
  }
});

// ---------------- Job status (and persist STL when ready) ----------------
app.get('/status/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const resp = await axios.get(`${PYTHON_URL}/status/${jobId}`);
    const data = resp.data || {};

    // Attach DB info (imageFileId, sourceFilename) if available
    if (MONGODB_URI) {
      try {
        await connectMongo();
        const jobDoc = await Job.findOne({ jobId });
        if (jobDoc) {
          data.imageFileId = jobDoc.imageFileId;
          data.sourceFilename = jobDoc.sourceFilename;
        }
      } catch (e) {
        console.warn('[status] DB lookup warning:', e.message);
      }
    }

    // If SUCCESS, fetch STL once and store in GridFS if not stored yet.
    if (data.state === 'SUCCESS' && data.result && MONGODB_URI) {
      try {
        await connectMongo();
        const jobDoc = await Job.findOne({ jobId });
        if (jobDoc && !jobDoc.stlFileId) {
          const dl = await axios.get(`${PYTHON_URL}/download/${jobId}`, { responseType: 'stream' });
          const filename = `${jobId}.stl`;
          const contentType = 'model/stl';

          // Pipe into GridFS
          await new Promise((resolve, reject) => {
            const up = gfsBucket.openUploadStream(filename, { contentType });
            dl.data.pipe(up)
              .on('error', reject)
              .on('finish', async () => {
                jobDoc.stlFileId = up.id;
                jobDoc.status = 'SUCCESS';
                await jobDoc.save();
                resolve();
              });
          });
        } else if (jobDoc && jobDoc.status !== data.state) {
          jobDoc.status = data.state;
          await jobDoc.save();
        }
      } catch (e) {
        // non-fatal
        console.warn('[status] STL persist warning:', e.message);
      }
    } else if (MONGODB_URI && data.state && ['RUNNING', 'FAILURE', 'QUEUED'].includes(data.state)) {
      // keep DB status in sync
      try {
        await connectMongo();
        await Job.updateMany({ jobId }, { $set: { status: data.state } });
      } catch { }
    }

    return res.json(data);
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    return res.status(500).json({ error: 'Failed to query Python service status' });
  }
});

// ---------------- Download passthrough (robust) ----------------
app.get('/download/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    console.log(`[Download] Request for ${jobId}`);

    // 1. Try to serve from MongoDB GridFS first (Persistent)
    if (MONGODB_URI) {
      try {
        await connectMongo();
        const jobDoc = await Job.findOne({ jobId });
        if (jobDoc && jobDoc.stlFileId) {
          console.log(`[Download] Serving ${jobId} from GridFS`);
          return streamGridFSFile(jobDoc.stlFileId, res);
        } else {
          console.log(`[Download] Job found in DB but no stlFileId (status: ${jobDoc?.status})`);
        }
      } catch (e) {
        console.warn(`[Download] DB lookup failed for ${jobId}, falling back to Python:`, e.message);
      }
    } else {
      console.warn('[Download] MONGODB_URI not set, skipping GridFS check');
    }

    // 2. Fallback to Python service (Ephemeral)
    console.log(`[Download] Serving ${jobId} from Python service`);
    const resp = await axios.get(`${PYTHON_URL}/download/${jobId}`, { responseType: 'stream' });
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}.stl"`);
    resp.data.pipe(res);

  } catch (err) {
    console.error(`[Download] Error for ${req.params.jobId}:`, err.message);
    if (err.response) {
      console.error(`[Download] Python response: ${err.response.status}`, err.response.data);
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: 'Failed to download result' });
  }
});

// ---------------- Stream files from Mongo GridFS ----------------
app.get('/files/:id', async (req, res) => {
  try {
    await connectMongo();
    if (!gfsBucket) return res.status(503).json({ error: 'storage unavailable' });
    streamGridFSFile(req.params.id, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- Health Check ----------------
app.get('/health', async (req, res) => {
  try {
    // Ping Python service to wake it up
    await axios.get(`${PYTHON_URL}/health`, { timeout: 5000 });
    res.json({
      status: 'ok',
      python: 'ok',
      mongo: MONGODB_URI ? (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected') : 'not_configured'
    });
  } catch (e) {
    // Even if Python is down/waking up, we return ok so frontend knows Node is up
    res.json({
      status: 'ok',
      python: 'down',
      error: e.message,
      mongo: MONGODB_URI ? (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected') : 'not_configured'
    });
  }
});

// ---------------- Start server ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  // Connect lazily; if no URI provided, auth/DB routes will respond 503/disabled as appropriate
  if (MONGODB_URI) {
    try { await connectMongo(); } catch (e) { console.error('[Mongo] connect error:', e.message); }
  }
  console.log(`Node API listening on ${PORT}`);
});