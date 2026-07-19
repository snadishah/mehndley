const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple JSON file-based storage (no DB needed to start)
const DATA_FILE = path.join(require('../config').DATA_DIR, 'projects.json');

class ProjectsController {
  // Anonymous per-browser workspace token (sent by the client). Scopes who owns
  // what without requiring accounts.
  _owner(req) {
    return (req.headers['x-owner'] || '').toString().slice(0, 80) || null;
  }
  _load() {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [] }));
    }
    // Never let a corrupt/half-written file take the whole API down.
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.projects)) return { projects: [] };
      return parsed;
    } catch (err) {
      console.error('[projects] Corrupt projects.json — backing up and starting fresh:', err.message);
      try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.corrupt-' + Date.now()); } catch (_) {}
      return { projects: [] };
    }
  }

  _save(data) {
    // Atomic write: write to a temp file then rename, so a crash mid-write
    // can never leave projects.json truncated/corrupt.
    const tmp = DATA_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }

  // Only your own workspace's projects — never anyone else's.
  list(req, res) {
    const owner = this._owner(req);
    const { projects } = this._load();
    const mine = projects.filter(p => owner && p.owner === owner);
    res.json({ projects: mine.sort((a, b) => b.updatedAt - a.updatedAt) });
  }

  // Fetch by id is public by design — this is how share links work. IDs are
  // unguessable (random suffix) so they can't be enumerated.
  get(req, res) {
    const { id } = req.params;
    const { projects } = this._load();
    const project = projects.find(p => p.id === id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  }

  save(req, res) {
    const { id, name, segments, spotifyTracks, relayConfig, transitionMode, fadeOptions } = req.body;
    const owner = this._owner(req);
    const data = this._load();

    const now = Date.now();
    // Unguessable id so share links can't be guessed/enumerated.
    const projectId = id || `proj_${now}_${crypto.randomBytes(6).toString('hex')}`;

    const existing = data.projects.findIndex(p => p.id === projectId);
    const prev = existing >= 0 ? data.projects[existing] : null;

    const project = {
      id: projectId,
      // Keep the original creator as owner (so shared collaborators editing via a
      // link don't steal it out of the creator's list).
      owner: prev ? (prev.owner || owner) : owner,
      name: (name || 'Untitled Mashup').toString().slice(0, 120),
      segments: segments || [],
      spotifyTracks: spotifyTracks || [],
      relayConfig:    relayConfig    || null,
      transitionMode: transitionMode || 'crossfade',
      fadeOptions:    fadeOptions    || null,
      updatedAt: now,
      createdAt: prev ? prev.createdAt : now,
    };

    if (existing >= 0) data.projects[existing] = project;
    else data.projects.push(project);

    this._save(data);
    res.json({ project, message: 'Project saved!' });
  }

  // You can only delete projects your workspace owns.
  delete(req, res) {
    const { id } = req.params;
    const owner = this._owner(req);
    const data = this._load();
    const target = data.projects.find(p => p.id === id);
    if (!target) return res.json({ success: true }); // already gone
    if (target.owner && target.owner !== owner) {
      return res.status(403).json({ error: 'Not allowed to delete this project' });
    }
    data.projects = data.projects.filter(p => p.id !== id);
    this._save(data);
    res.json({ success: true });
  }
}

module.exports = new ProjectsController();
