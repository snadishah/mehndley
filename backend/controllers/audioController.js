const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { UPLOADS_DIR, OUTPUT_DIR } = require('../config');
const YTDLP = process.env.YTDLP_PATH || '/opt/homebrew/bin/yt-dlp';

// ── Input helpers ──────────────────────────────────────────────
// Clamp any client-supplied value to a finite number in [min,max].
function num(v, def, min, max) {
  const n = parseFloat(v);
  if (!isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
// Force a filename to stay inside UPLOADS_DIR (defeats ../../ traversal).
function safeUpload(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  const full = path.join(UPLOADS_DIR, base);
  if (!full.startsWith(UPLOADS_DIR)) return null;
  return full;
}

// Estimated output length (seconds) — used only as the denominator for the % bar.
function expectedDuration({ clips, relay, mode, crossfade }) {
  const sum = clips.reduce((a, c) => a + c.dur, 0);
  if (mode === 'relay' && relay) {
    const placements = (relay.atStart ? 1 : 0) + Math.max(0, clips.length - 1) + (relay.atEnd ? 1 : 0);
    return Math.max(0.1, sum + relay.dur * placements + (relay.gap > 0 ? relay.gap * 2 * placements : 0));
  }
  if (crossfade < 4) {
    const minDur = clips.length ? Math.min(...clips.map(c => c.dur)) : 1;
    const cd = Math.max(0.1, Math.min(crossfade, minDur * 0.9));
    return Math.max(0.1, sum - cd * Math.max(0, clips.length - 1));
  }
  const gap = Math.max(0, crossfade - 4);
  return Math.max(0.1, sum + gap * Math.max(0, clips.length - 1));
}

async function probeDuration(file) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    const d = parseFloat(stdout.trim());
    return isFinite(d) ? d : 0;
  } catch (_) { return 0; }
}

// Only allow fetching preview clips from Apple's CDN (defeats SSRF via previewUrl).
function isApplePreview(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      (u.hostname.endsWith('.apple.com') || u.hostname.endsWith('.mzstatic.com'));
  } catch (_) { return false; }
}

// Fallback source: download the iTunes 30s preview (m4a) and transcode to mp3.
// Used when YouTube blocks the datacenter IP ("confirm you're not a bot").
async function downloadPreview(previewUrl, safeName) {
  if (!isApplePreview(previewUrl)) throw new Error('invalid preview url');
  const filename = `${safeName}_${Date.now()}.mp3`;
  const outPath = path.join(UPLOADS_DIR, filename);
  await execFileAsync('ffmpeg', ['-y', '-i', previewUrl, '-acodec', 'libmp3lame', '-ab', '256k', outPath],
    { timeout: 30000 });
  return { filename, outPath };
}

class AudioController {
  // ── Download a full track from YouTube via yt-dlp ──────────────
  async downloadFromYouTube(req, res) {
    const { query, trackName, artistName, youtubeId, previewUrl } = req.body;
    const safeName = (trackName || query || 'track')
      .replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_').substring(0, 50) || 'track';
    const outputTemplate = path.join(UPLOADS_DIR, `${safeName}_${Date.now()}.%(ext)s`);

    // Read cookies at call time (materialized from a Fly secret at startup).
    const COOKIES = process.env.YTDLP_COOKIES;

    // Only accept a real 11-char YouTube id; otherwise fall back to a search.
    const validId = typeof youtubeId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId);
    const source = validId
      ? `https://youtube.com/watch?v=${youtubeId}`
      : `ytsearch1:${trackName || query || ''} ${artistName || ''} audio`.trim();

    const args = [
      source,
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
      '--output', outputTemplate,
      '--no-playlist', '--max-downloads', '1', '--no-warnings',
      '--print', 'after_move:filepath', '--print', 'id',
    ];
    if (COOKIES && fs.existsSync(COOKIES)) {
      // Browser-exported cookies belong to the web client.
      args.push('--cookies', COOKIES, '--extractor-args', 'youtube:player_client=web,default');
    } else {
      args.push('--extractor-args', 'youtube:player_client=android,web');
    }

    console.log(`[yt-dlp] Downloading: ${source}`);
    let ytdlp;
    try {
      ytdlp = spawn(YTDLP, args);
    } catch (err) {
      return res.status(500).json({ error: 'yt-dlp not available: ' + err.message });
    }

    let finalPath = '', videoId = '', stderr = '', responded = false;
    const lines = [];
    const done = (fn) => { if (responded) return; responded = true; clearTimeout(killTimer); fn(); };

    // Hard timeout — never let a stuck download hang the request forever.
    const killTimer = setTimeout(() => {
      try { ytdlp.kill('SIGKILL'); } catch (_) {}
      done(() => res.status(504).json({ error: 'Download timed out. Try another track.' }));
    }, 90000);

    ytdlp.on('error', (err) => {
      done(() => res.status(500).json({ error: 'yt-dlp failed to start: ' + err.message }));
    });

    ytdlp.stdout.on('data', d => {
      d.toString().split('\n').forEach(line => {
        line = line.trim(); if (!line) return; lines.push(line);
        if (line.endsWith('.mp3')) finalPath = line;
        else if (/^[a-zA-Z0-9_-]{11}$/.test(line)) videoId = line;
      });
    });
    ytdlp.stderr.on('data', d => { stderr += d.toString(); });

    ytdlp.on('close', () => {
      done(async () => {
        if (!finalPath || !fs.existsSync(finalPath)) {
          const files = fs.readdirSync(UPLOADS_DIR)
            .filter(f => f.includes(safeName) && f.endsWith('.mp3'))
            .sort((a, b) => fs.statSync(path.join(UPLOADS_DIR, b)).mtime - fs.statSync(path.join(UPLOADS_DIR, a)).mtime);
          if (files.length > 0) {
            finalPath = path.join(UPLOADS_DIR, files[0]);
          } else if (previewUrl && isApplePreview(previewUrl)) {
            // YouTube blocked us — fall back to the iTunes 30s preview.
            try {
              console.log('[yt-dlp] blocked; using iTunes preview fallback');
              const { filename, outPath } = await downloadPreview(previewUrl, safeName);
              return res.json({ success: true, filename, url: `/uploads/${filename}`, thumbnailUrl: null, videoId: null, source: 'preview' });
            } catch (e) {
              return res.status(500).json({ error: 'Download failed (and preview fallback failed): ' + e.message });
            }
          } else {
            return res.status(500).json({ error: 'Download failed: ' + (stderr.substring(0, 200) || 'no audio found') });
          }
        }
        const filename = path.basename(finalPath);
        const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
        res.json({ success: true, filename, url: `/uploads/${filename}`, thumbnailUrl, videoId });
      });
    });
  }

  // ── Mix segments into one medley — single ffmpeg pass ──────────
  async mixAudio(req, res) {
    try {
      const body = req.body || {};
      const rawSegments = Array.isArray(body.segments) ? body.segments : [];
      if (rawSegments.length < 1) return res.status(400).json({ error: 'At least 1 segment required' });
      if (rawSegments.length > 40) return res.status(400).json({ error: 'Too many segments (max 40)' });

      const fade = body.fadeOptions || {};
      const fadeEnabled = !!fade.enabled;
      const fadeIn = num(fade.fadeInDuration, 1.5, 0, 10);
      const fadeOut = num(fade.fadeOutDuration, 1.5, 0, 10);

      // Validate + normalise each segment (probe duration when end is unknown).
      const clips = [];
      for (const seg of rawSegments) {
        const file = safeUpload(seg.filename);
        if (!file || !fs.existsSync(file)) {
          return res.status(400).json({ error: `File not found: ${seg && seg.filename}` });
        }
        let start = num(seg.start, 0, 0, 100000);
        let end = num(seg.end, 0, 0, 100000);
        if (end <= start) end = await probeDuration(file);
        if (end <= start) return res.status(400).json({ error: `Invalid trim for ${path.basename(file)}` });
        clips.push({ file, start, end, dur: end - start });
      }

      // Optional relay clip.
      let relay = null;
      const rc = body.relayConfig;
      if (rc && rc.filename) {
        const file = safeUpload(rc.filename);
        if (!file || !fs.existsSync(file)) return res.status(400).json({ error: 'Relay file not found' });
        let start = num(rc.start, 0, 0, 100000);
        let end = num(rc.end, 0, 0, 100000);
        if (end <= start) end = await probeDuration(file);
        if (end <= start) return res.status(400).json({ error: 'Invalid relay trim' });
        relay = {
          file, start, end, dur: end - start,
          gap: num(rc.gapDuration, 0, 0, 30),
          atStart: !!rc.playAtStart,
          atEnd: !!rc.playAtEnd,
        };
      }

      const mode = relay ? 'relay' : 'crossfade';
      const crossfade = num(body.crossfadeDuration, 2, 0, 60);
      const normalize = body.normalize !== false; // default ON — consistent loudness

      const outputFilename = `mashup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);

      const { inputs, filter } = this._buildGraph({ clips, relay, mode, crossfade, fadeEnabled, fadeIn, fadeOut, normalize });
      const expected = expectedDuration({ clips, relay, mode, crossfade }); // seconds, for the % denominator

      // `-progress pipe:1` makes ffmpeg print machine-readable progress we stream to the browser.
      const args = ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]',
        '-acodec', 'libmp3lame', '-ab', '320k', '-progress', 'pipe:1', '-nostats', outputPath];

      console.log(`[FFmpeg] Mixing ${clips.length} clip(s), mode=${mode}, ~${expected.toFixed(1)}s out`);

      // Stream progress back as Server-Sent Events over this POST response.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
      send({ percent: 0 });

      const ff = spawn('ffmpeg', args);
      let stderr = '';
      let lastPct = 0;
      let outBuf = '';
      let finished = false;

      ff.stdout.on('data', (d) => {
        outBuf += d.toString();
        let nl;
        while ((nl = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, nl).trim();
          outBuf = outBuf.slice(nl + 1);
          const m = line.match(/^out_time_us=(\d+)/) || line.match(/^out_time_ms=(\d+)/);
          if (m) {
            const secs = line.startsWith('out_time_ms') ? Number(m[1]) / 1e3 : Number(m[1]) / 1e6;
            const pct = Math.max(0, Math.min(99, Math.round((secs / expected) * 100)));
            if (pct > lastPct) { lastPct = pct; send({ percent: pct }); }
          }
        }
      });
      ff.stderr.on('data', (d) => { stderr += d.toString(); });

      // If the browser aborts mid-render, don't leave ffmpeg running.
      // (Guard with `finished` so the normal end-of-response close doesn't kill it.)
      res.on('close', () => { if (!finished) { try { ff.kill('SIGKILL'); } catch (_) {} } });

      ff.on('error', (err) => { finished = true; send({ error: 'ffmpeg failed to start: ' + err.message }); res.end(); });

      ff.on('close', async (code) => {
        finished = true;
        if (code !== 0 || !fs.existsSync(outputPath)) {
          const msg = stderr.split('\n').filter(Boolean).slice(-3).join(' ') || 'render failed';
          console.error('[FFmpeg] Error:', msg);
          send({ error: 'Mix failed: ' + msg.substring(0, 300) });
          return res.end();
        }
        const stats = fs.statSync(outputPath);
        const duration = Math.round(await probeDuration(outputPath));
        send({ percent: 100 });
        send({
          done: true, success: true, filename: outputFilename,
          url: `/output/${outputFilename}`, sizeMB: (stats.size / 1024 / 1024).toFixed(2), duration,
        });
        res.end();
      });
    } catch (err) {
      // Only reachable for setup errors before streaming began.
      const msg = err && err.message ? err.message : 'unknown error';
      console.error('[Mix] Error:', msg);
      if (!res.headersSent) res.status(500).json({ error: 'Mix failed: ' + msg.substring(0, 300) });
      else { try { res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n'); res.end(); } catch (_) {} }
    }
  }

  // Build a single filter_complex graph for the whole medley.
  _buildGraph({ clips, relay, mode, crossfade, fadeEnabled, fadeIn, fadeOut, normalize }) {
    const inputs = [];
    const parts = [];
    clips.forEach(c => { inputs.push('-i', c.file); });

    // loudnorm brings every clip to the same perceived loudness (EBU R128, -16 LUFS)
    // so a medley doesn't jump between quiet and blaring tracks.
    const NORM = normalize ? 'loudnorm=I=-16:TP=-1.5:LRA=11,' : '';
    const COMMON = NORM + 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
    const fadeFor = (dur) => {
      if (!fadeEnabled) return '';
      const fi = Math.min(fadeIn, dur / 2);
      const fo = Math.min(fadeOut, dur / 2);
      return `,afade=t=in:st=0:d=${fi},afade=t=out:st=${Math.max(0, dur - fo)}:d=${fo}`;
    };

    // Prepared main clips → labels [m0]..[mN-1]
    clips.forEach((c, i) => {
      parts.push(`[${i}:a]atrim=${c.start}:${c.end},asetpts=PTS-STARTPTS,${COMMON}${fadeFor(c.dur)}[m${i}]`);
    });

    if (mode === 'relay' && relay) {
      // Relay input.
      const relIdx = clips.length;
      inputs.push('-i', relay.file);
      parts.push(`[${relIdx}:a]atrim=${relay.start}:${relay.end},asetpts=PTS-STARTPTS,${COMMON}${fadeFor(relay.dur)}[relsrc]`);

      // How many relay placements? start + between-tracks + end.
      const placements = (relay.atStart ? 1 : 0) + Math.max(0, clips.length - 1) + (relay.atEnd ? 1 : 0);
      const relLabels = [];
      if (placements === 1) { relLabels.push('rel0'); parts.push(`[relsrc]anull[rel0]`); }
      else if (placements > 1) {
        for (let k = 0; k < placements; k++) relLabels.push('rel' + k);
        parts.push(`[relsrc]asplit=${placements}[${relLabels.join('][')}]`);
      }

      // Silence input (split into 2 copies per placement).
      let silLabels = [];
      if (relay.gap > 0 && placements > 0) {
        const silIdx = inputs.length / 2; // each input is 2 args
        inputs.push('-f', 'lavfi', '-t', String(relay.gap), '-i', `anullsrc=r=44100:cl=stereo`);
        const need = placements * 2;
        for (let k = 0; k < need; k++) silLabels.push('sil' + k);
        if (need === 1) parts.push(`[${silIdx}:a]anull[sil0]`);
        else parts.push(`[${silIdx}:a]asplit=${need}[${silLabels.join('][')}]`);
      }

      // Assemble the ordered sequence of labels.
      const seq = [];
      let relPtr = 0, silPtr = 0;
      const pushRelay = () => {
        if (silLabels.length) seq.push(silLabels[silPtr++]);
        seq.push(relLabels[relPtr++]);
        if (silLabels.length) seq.push(silLabels[silPtr++]);
      };
      if (relay.atStart) pushRelay();
      clips.forEach((c, i) => {
        seq.push('m' + i);
        if (i < clips.length - 1) pushRelay();
      });
      if (relay.atEnd) pushRelay();

      parts.push(`[${seq.join('][')}]concat=n=${seq.length}:v=0:a=1[out]`);
      return { inputs, filter: parts.join(';') };
    }

    // ── Crossfade mode ──
    if (clips.length === 1) {
      parts.push(`[m0]anull[out]`);
      return { inputs, filter: parts.join(';') };
    }

    // Smooth acrossfade needs each clip longer than the blend; clamp to fit.
    const minDur = Math.min(...clips.map(c => c.dur));
    if (crossfade < 4) {
      const cd = Math.max(0.1, Math.min(crossfade, minDur * 0.9));
      let cur = 'm0';
      for (let i = 1; i < clips.length; i++) {
        const outLbl = i === clips.length - 1 ? 'out' : 'cf' + i;
        parts.push(`[${cur}][m${i}]acrossfade=d=${cd}:c1=tri:c2=tri[${outLbl}]`);
        cur = outLbl;
      }
      return { inputs, filter: parts.join(';') };
    }

    // Long blend → fade out/in with a silence gap between clips, then concat.
    const gap = Math.max(0, crossfade - 4);
    let silLabels = [];
    if (gap > 0) {
      const silIdx = inputs.length / 2;
      inputs.push('-f', 'lavfi', '-t', String(gap), '-i', `anullsrc=r=44100:cl=stereo`);
      const need = clips.length - 1;
      for (let k = 0; k < need; k++) silLabels.push('gsil' + k);
      if (need === 1) parts.push(`[${silIdx}:a]anull[gsil0]`);
      else parts.push(`[${silIdx}:a]asplit=${need}[${silLabels.join('][')}]`);
    }
    const seq = [];
    clips.forEach((c, i) => {
      seq.push('m' + i);
      if (i < clips.length - 1 && silLabels.length) seq.push(silLabels[i]);
    });
    parts.push(`[${seq.join('][')}]concat=n=${seq.length}:v=0:a=1[out]`);
    return { inputs, filter: parts.join(';') };
  }

  async deleteFile(req, res) {
    const filePath = safeUpload(req.params.filename);
    if (filePath && fs.existsSync(filePath)) { fs.unlinkSync(filePath); res.json({ success: true }); }
    else res.status(404).json({ error: 'File not found' });
  }
}

module.exports = new AudioController();
