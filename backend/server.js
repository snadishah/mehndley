require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const spotifyRoutes = require('./routes/spotify');
const audioRoutes = require('./routes/audio');
const projectRoutes = require('./routes/projects');
const { UPLOADS_DIR, OUTPUT_DIR, DATA_DIR } = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Search now uses the keyless iTunes Search API — no API key required.

// Ensure storage dirs exist (these map to the persistent volume in prod)
[UPLOADS_DIR, OUTPUT_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
// Bodies are only small JSON (project metadata + segment lists). Audio never
// travels through the body — it's fetched server-side — so keep this tight.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Minimal in-memory rate limiter (no external deps) ──
// Protects the expensive yt-dlp / ffmpeg endpoints from being hammered.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count++;
    hits.set(key, rec);
    if (rec.count > max) {
      return res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' });
    }
    next();
  };
}
const heavyLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

// Serve frontend. `extensions: html` lets clean URLs (/guides/foo) resolve to
// foo.html — nicer for SEO and users.
app.use(express.static(path.join(__dirname, '../frontend'), { extensions: ['html'] }));

// Serve downloaded audio files (immutable — safe to cache hard)
const staticOpts = { maxAge: '7d', immutable: true };
app.use('/uploads', express.static(UPLOADS_DIR, staticOpts));
app.use('/output', express.static(OUTPUT_DIR, staticOpts));

// API Routes
app.use('/api/spotify', spotifyRoutes);
app.use('/api/audio', heavyLimiter, audioRoutes);
app.use('/api/projects', projectRoutes);

// The mixer app lives at /app; the landing page is the root.
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/app.html'));
});

// Serve the landing page for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Disk cleanup ──
// Free hosting has tiny disks. Purge uploads/output files older than the TTL
// so downloaded tracks and rendered mashups don't accumulate forever.
const FILE_TTL_MS = (parseInt(process.env.FILE_TTL_HOURS, 10) || 24) * 60 * 60 * 1000;
function cleanupOldFiles() {
  const now = Date.now();
  [UPLOADS_DIR, OUTPUT_DIR].forEach(full => {
    fs.readdir(full, (err, files) => {
      if (err) return;
      files.forEach(f => {
        const fp = path.join(full, f);
        fs.stat(fp, (e, st) => {
          if (e || !st.isFile()) return;
          if (now - st.mtimeMs > FILE_TTL_MS) fs.unlink(fp, () => {});
        });
      });
    });
  });
}
cleanupOldFiles();
setInterval(cleanupOldFiles, 60 * 60 * 1000); // hourly

// ── Keep yt-dlp fresh ──
// YouTube changes often; a stale yt-dlp silently stops downloading. Self-update
// in the background (after the server is already listening, so cold-starts aren't
// delayed) on boot and once a day.
function refreshYtDlp() {
  const bin = process.env.YTDLP_PATH || 'yt-dlp';
  try {
    const p = spawn(bin, ['-U'], { stdio: 'ignore', detached: true });
    p.on('error', () => {});   // ignore if unavailable
    p.on('close', (code) => console.log(`[yt-dlp] self-update exited ${code}`));
    p.unref();
  } catch (_) {}
}

app.listen(PORT, () => {
  console.log(`🎵 Mehndi Mixer running at http://localhost:${PORT}`);
  setTimeout(refreshYtDlp, 5000);                 // shortly after boot
  setInterval(refreshYtDlp, 24 * 60 * 60 * 1000); // daily
});