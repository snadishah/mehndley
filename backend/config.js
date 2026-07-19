const path = require('path');

// All mutable storage lives under one base dir so it can be mapped to a
// persistent Fly.io volume. Set MM_STORAGE=/data in production; falls back
// to the repo root for local dev.
const BASE = process.env.MM_STORAGE || path.join(__dirname, '..');

module.exports = {
  BASE,
  UPLOADS_DIR: path.join(BASE, 'uploads'),
  OUTPUT_DIR:  path.join(BASE, 'output'),
  DATA_DIR:    path.join(BASE, 'data'),
};
