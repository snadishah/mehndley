'use strict';
// Escape untrusted strings (song titles, artists, project names) before
// they go into innerHTML — prevents stored/reflected XSS.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
let searchDebounce;
let currentProjectId = null;
let transitionMode = 'crossfade';
let relayConfig = null;
let relayWS = null;
let previewWS = null;

// ── Theme ──
const themeBtn = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('mm-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
themeBtn.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
themeBtn.onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeBtn.textContent = next === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('mm-theme', next);
};

// ── Navigation ──
document.querySelectorAll('.tnav').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tnav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'projects') loadProjects();
    if (btn.dataset.view === 'timeline') timeline.render();
  };
});

// ── Fade controls ──
document.getElementById('fadeEnabled').addEventListener('change', function() {
  document.getElementById('fade-ctrl').style.display = this.checked ? '' : 'none';
});
document.getElementById('fadeInSlider').addEventListener('input', function() {
  document.getElementById('fadeInVal').textContent = this.value + 's';
});
document.getElementById('fadeOutSlider').addEventListener('input', function() {
  document.getElementById('fadeOutVal').textContent = this.value + 's';
});

function getFadeOptions() {
  return {
    enabled:         document.getElementById('fadeEnabled').checked,
    fadeInDuration:  parseFloat(document.getElementById('fadeInSlider').value)  || 1.5,
    fadeOutDuration: parseFloat(document.getElementById('fadeOutSlider').value) || 1.5,
  };
}

// ── Search ──
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

searchInput.addEventListener('input', () => {
  searchClear.style.display = searchInput.value ? '' : 'none';
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const q = searchInput.value.trim();
    if (q.length >= 2) performSearch(q);
  }, 500);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(searchDebounce); performSearch(searchInput.value.trim()); }
});
searchClear.onclick = () => { searchInput.value = ''; searchClear.style.display = 'none'; loadFeatured(); };
document.querySelectorAll('.qtag').forEach(tag => {
  tag.onclick = () => { searchInput.value = tag.dataset.q; searchClear.style.display = ''; performSearch(tag.dataset.q); };
});

function showSearchState(html) {
  document.getElementById('search-state').innerHTML = html;
  document.getElementById('search-state').style.display = '';
  document.getElementById('results-grid').style.display = 'none';
  document.getElementById('results-grid').innerHTML = '';
}

function showResults(tracks) {
  if (!tracks || !tracks.length) {
    showSearchState('<p style="color:var(--text2);font-size:14px;padding:20px 0">No results found.</p>');
    return;
  }
  document.getElementById('search-state').style.display = 'none';
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  grid.style.display = 'grid';
  tracks.forEach(t => grid.appendChild(buildCard(t)));
}

async function loadFeatured() {
  showSearchState('<div class="state-spinner"><div class="spinner"></div><p>Loading featured songs…</p></div>');
  try {
    const r = await API.getFeatured();
    if (r.error) throw new Error(r.error);
    showResults(r.tracks || []);
  } catch(e) {
    showSearchState('<p style="color:var(--accent);font-size:14px">⚠ ' + e.message + '</p>');
  }
}

async function performSearch(q) {
  if (!q) { loadFeatured(); return; }
  showSearchState('<div class="state-spinner"><div class="spinner"></div><p>Searching…</p></div>');
  try {
    const r = await API.search(q);
    if (r.error) throw new Error(r.error);
    showResults(r.tracks || []);
  } catch(e) {
    showSearchState('<p style="color:var(--accent);font-size:14px">⚠ ' + e.message + '</p>');
  }
}

function buildCard(track) {
  const card = document.createElement('div');
  card.className = 'track-card';
  const hasArt = track.albumArt && track.albumArt.startsWith('http');
  card.innerHTML =
    '<div class="card-art">' +
      (hasArt
        ? '<img src="' + track.albumArt + '" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=card-art-placeholder>🎵</div>\'" />'
        : '<div class="card-art-placeholder">🎵</div>') +
      '<div class="card-art-overlay"><button class="card-play-btn">▶</button></div>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="card-name" title="' + esc(track.name) + '">' + esc(track.name) + '</div>' +
      '<div class="card-artist">' + esc(track.artist) + '</div>' +
      '<button class="card-add-btn">+ Add to Timeline</button>' +
    '</div>';

  card.querySelector('.card-play-btn').onclick = () =>
    window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent((track.name||'') + ' ' + (track.artist||'')), '_blank');

  const addBtn = card.querySelector('.card-add-btn');
  addBtn.onclick = () => addToTimeline(track, addBtn);
  return card;
}

async function addToTimeline(track, btn) {
  btn.disabled = true;
  btn.textContent = '⏬ Downloading…';
  document.querySelector('[data-view="timeline"]').click();
  showToast('Downloading "' + track.name + '"…');

  const seg = timeline.add(track);
  if (!seg) { btn.disabled = false; btn.textContent = '+ Add to Timeline'; return; }
  timeline.render();

  try {
    const result = await API.downloadAudio(track.name, track.artist, track.youtubeId, track.previewUrl);
    if (result.error) throw new Error(result.error);
    if (!result.filename) throw new Error('No filename in response');

    seg.filename = result.filename;
    seg.audioUrl = result.url;

    // Update album art with YouTube thumbnail
    if (result.thumbnailUrl && (!seg.albumArt || !seg.albumArt.startsWith('http'))) {
      seg.albumArt = result.thumbnailUrl;
      const card = document.querySelector('[data-seg-id="' + seg.id + '"]');
      if (card) {
        const art = card.querySelector('.tl-art');
        if (art) art.innerHTML = '<img src="' + result.thumbnailUrl + '" alt="" onerror="this.style.display=\'none\'" />';
      }
    }

    timeline.updateSegmentAudio(seg.id);
    showToast('"' + track.name + '" ready! 🎵', 'success');
    btn.textContent = '✓ Added';
    btn.classList.add('added');
  } catch(e) {
    console.error('Download failed:', e);
    timeline.remove(seg.id);
    showToast('Download failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '+ Add to Timeline';
  }
}

// ── Transition Mode ──
window.setTransitionMode = function(mode) {
  transitionMode = mode;
  document.getElementById('mode-crossfade').classList.toggle('active', mode === 'crossfade');
  document.getElementById('mode-relay').classList.toggle('active', mode === 'relay');
  document.getElementById('crossfade-ctrl').style.display = mode === 'crossfade' ? '' : 'none';
  document.getElementById('relay-ctrl').style.display     = mode === 'relay'      ? '' : 'none';
};

document.getElementById('crossfadeSlider').addEventListener('input', function() {
  document.getElementById('crossfadeVal').textContent = this.value + 's';
});

function buildRelayConfig() {
  if (!relayConfig) return null;
  return Object.assign({}, relayConfig, {
    gapDuration: parseFloat(document.getElementById('relayGapSlider')?.value) || 0,
    playAtStart: document.getElementById('relayAtStart')?.checked !== false,
    playAtEnd:   document.getElementById('relayAtEnd')?.checked   !== false,
  });
}

// ── Build export segments safely ──
// This handles the case where waveform hasn't loaded yet (duration = 0, end = null)
function buildExportSegments(segments) {
  return segments
    .filter(s => s.filename) // only segments with downloaded audio
    .map(s => ({
      filename:  s.filename,
      start:     s.start || 0,
      // If end/duration not set (waveform not loaded), pass 0 — FFmpeg will use full file
      end:       s.end && s.end > 0 ? s.end : (s.duration > 0 ? s.duration : 0),
      trackName: s.name,
    }));
}

// ── Export ──
document.getElementById('exportTimelineBtn').addEventListener('click', () => runExport(null));

async function runExport(segmentsOverride, pMode, pRelay, pFade) {
  // Use project config if passed, otherwise use current UI state
  const mode = pMode || transitionMode;
  
  // CRITICAL FIX: Force crossfade to 0 if we are using a relay!
  const cf   = mode === 'relay' ? 0 : (parseInt(document.getElementById('crossfadeSlider').value) || 2);
  const activeRelay = mode === 'relay' ? (pRelay || buildRelayConfig()) : null;
  const activeFade  = pFade || getFadeOptions();
  
  const segs = segmentsOverride || buildExportSegments(timeline.segments);

  if (!segs.length) { showToast('No tracks to export', 'error'); return; }

  const missing = segs.filter(s => !s.filename);
  if (missing.length) { showToast('Some tracks are still downloading', 'error'); return; }

  const modal     = document.getElementById('exportModal');
  const progress  = document.getElementById('exportProgress');
  const statusEl  = document.getElementById('exportStatus');
  const resultDiv = document.getElementById('exportResult');
  const link      = document.getElementById('downloadLink');

  modal.style.display = 'flex';
  resultDiv.style.display = 'none';
  // Real streaming progress from ffmpeg (SSE). Indeterminate until the first
  // percent arrives, then a true determinate bar.
  progress.style.width = '100%';
  progress.classList.add('indet');
  const t0 = Date.now();
  const label = 'Mixing ' + segs.length + ' track' + (segs.length !== 1 ? 's' : '');
  let started = false;
  const iv = setInterval(() => {
    if (!started) statusEl.textContent = label + '… (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)';
  }, 100);
  const onProg = (pct) => {
    if (!started) { started = true; progress.classList.remove('indet'); }
    progress.style.width = pct + '%';
    statusEl.textContent = label + '… ' + pct + '%';
  };

  try {
    const result = await API.mix(segs, cf, activeRelay, activeFade, onProg);
    clearInterval(iv);
    progress.classList.remove('indet');
    progress.style.width = '100%';
    if (result.error) throw new Error(result.error);
    statusEl.textContent = '✓ ' + (result.duration ? fmtTime(result.duration) + ' mashup ready!' : 'Done!');
    link.href     = result.url;
    link.download = 'mehndley_' + Date.now() + '.mp3';
    resultDiv.style.display = 'block';
    showToast('Mashup ready! 🎉', 'success');
  } catch(e) {
    clearInterval(iv);
    progress.classList.remove('indet');
    progress.style.width = '0%';
    statusEl.textContent = 'Error: ' + e.message;
    showToast(e.message, 'error');
  }
}

document.getElementById('closeModal').onclick = () => {
  document.getElementById('exportModal').style.display = 'none';
};

// ── Preview ──
document.getElementById('previewAllBtn').onclick = () => {
  const segs = buildExportSegments(timeline.segments);
  if (!segs.length) { showToast('No downloaded tracks yet', 'error'); return; }
  openPreview(segs);
};

document.getElementById('closePreview').onclick = () => {
  document.getElementById('previewModal').style.display = 'none';
  if (previewWS) { try { previewWS.pause(); } catch(e) {} }
};

// ── REPLACE YOUR ENTIRE openPreview FUNCTION WITH THIS ──
// Also replace the preview modal HTML in index.html with the one below

async function openPreview(segs) {
  if (!segs || !segs.length) { showToast('No audio loaded yet', 'error'); return; }

  // Show modal immediately with loading state
  const modal = document.getElementById('previewModal');
  modal.style.display = 'flex';
  document.getElementById('preview-status').textContent = 'Mixing ' + segs.length + ' tracks…';
  document.getElementById('preview-waveform').innerHTML = '';
  document.getElementById('preview-controls').style.display = 'none';
  document.getElementById('preview-track-list').innerHTML = '';
  document.getElementById('preview-dl-row').style.display = 'none';

  // Show a spinner inside the waveform area while mixing
  const waveEl = document.getElementById('preview-waveform');
  waveEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;gap:10px"><div class="spinner"></div><span style="color:var(--text2);font-size:13px">Mixing with FFmpeg…</span></div>';

  const cf    = parseInt(document.getElementById('crossfadeSlider').value) || 2;
  const relay = transitionMode === 'relay' ? buildRelayConfig() : null;
  const fade  = getFadeOptions();

  try {
    const result = await API.mix(segs, cf, relay, fade, (pct) => {
      document.getElementById('preview-status').textContent = 'Mixing… ' + pct + '%';
    });
    if (result.error) throw new Error(result.error);

    document.getElementById('preview-status').textContent =
      result.duration ? fmtTime(result.duration) + ' medley' : 'Medley ready';

    // Clear spinner
    waveEl.innerHTML = '';

    // Destroy old instance
    if (previewWS) {
      try { previewWS.destroy(); } catch(e) {}
      previewWS = null;
    }

    // Force the container to a known pixel width before WaveSurfer measures it
      waveEl.style.width = '100%';
      waveEl.style.minHeight = '80px';

      // Wait for paint
      await new Promise(r => setTimeout(r, 300));

      // Explicitly set pixel width so WaveSurfer doesn't measure 0
      const containerWidth = waveEl.getBoundingClientRect().width;
      if (containerWidth > 0) waveEl.style.width = containerWidth + 'px';

      // Create WaveSurfer
      previewWS = WaveSurfer.create({
      container:     waveEl,
      ...wfColors(),
      cursorWidth:   2,
      barWidth:      2,
      barGap:        1,
      barRadius:     2,
      height:        80,
      normalize:     true,
      url:           result.url,
    });

    previewWS.on('ready', () => {
      document.getElementById('preview-total').textContent = fmtTime(previewWS.getDuration());
      document.getElementById('preview-controls').style.display = 'flex';
      // Reset width to responsive after render
      waveEl.style.width = '100%';
    });

    previewWS.on('timeupdate', t => {
      document.getElementById('preview-curr').textContent = fmtTime(t);
    });

    previewWS.on('play',  () => { document.getElementById('preview-play').textContent = '⏸'; });
    previewWS.on('pause', () => { document.getElementById('preview-play').textContent = '▶'; });
    previewWS.on('finish',() => { document.getElementById('preview-play').textContent = '▶'; });

    previewWS.on('error', e => {
      console.error('Preview WaveSurfer error:', e);
      document.getElementById('preview-status').textContent = 'Audio ready — click Download to save';
      document.getElementById('preview-controls').style.display = 'flex';
    });

    document.getElementById('preview-play').onclick = () => {
      if (previewWS) previewWS.playPause();
    };

    // Track list
    const listEl = document.getElementById('preview-track-list');
    segs.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'preview-track-item';
      const endLabel = s.end && s.end > 0 ? fmtTime(s.end) : 'end';
      item.innerHTML =
        '<div class="preview-track-dot"></div>' +
        '<span>' + (i + 1) + '. ' + esc(s.trackName || s.name || 'Track') + '</span>' +
        '<span style="margin-left:auto;font-size:11px;color:var(--text3)">' +
          fmtTime(s.start || 0) + ' → ' + endLabel +
        '</span>';
      listEl.appendChild(item);
    });

    // Download link
    const dlLink = document.getElementById('previewDownloadLink');
    dlLink.href     = result.url;
    dlLink.download = 'mehndley_' + Date.now() + '.mp3';
    document.getElementById('preview-dl-row').style.display = '';

  } catch(e) {
    console.error('Preview failed:', e);
    waveEl.innerHTML = '';
    document.getElementById('preview-status').textContent = '⚠ Error: ' + e.message;
  }
}

// ── Relay Picker ──
window.openRelayPicker = function() {
  document.getElementById('relayModal').style.display = 'flex';
  document.getElementById('relay-results').innerHTML = '';
  document.getElementById('relay-selected').style.display = 'none';
  document.getElementById('relay-confirm-btn').disabled = true;
  document.getElementById('relaySearchInput').value = '';
  if (relayWS) { try { relayWS.destroy(); } catch(e) {} relayWS = null; }
};

window.closeRelayPicker = function() {
  document.getElementById('relayModal').style.display = 'none';
};

window.openRelayEditor = function() {
  if (!relayConfig || !relayConfig.audioUrl) return;
  document.getElementById('relayModal').style.display = 'flex';
  document.getElementById('relay-results').innerHTML = '';
  document.getElementById('relaySearchInput').value = relayConfig.name || '';
  document.getElementById('relay-selected').style.display = '';
  document.getElementById('relay-confirm-btn').disabled = false;
  document.getElementById('relay-sel-name').textContent   = relayConfig.name   || '';
  document.getElementById('relay-sel-artist').textContent = relayConfig.artist || '';
  const artEl = document.getElementById('relay-sel-art');
  if (artEl) artEl.src = relayConfig.albumArt || '';

  const gapSlider = document.getElementById('relayGapSlider');
  if (gapSlider && relayConfig.gapDuration != null) {
    gapSlider.value = relayConfig.gapDuration;
    updateGapUI(relayConfig.gapDuration);
  }

  document.getElementById('relay-waveform').innerHTML = '';
  if (relayWS) { try { relayWS.destroy(); } catch(e) {} relayWS = null; }

  relayWS = WaveSurfer.create({
    container:     document.getElementById('relay-waveform'),
    ...wfColors(),
    barWidth: 2, barGap: 1, barRadius: 2, height: 72,
    url: relayConfig.audioUrl,
  });
  relayWS.on('ready', () => {
    if (!relayConfig.duration) relayConfig.duration = relayWS.getDuration();
    if (!relayConfig.end)      relayConfig.end      = relayConfig.duration;
    updateRelayUI();
    initRelayDrag();
    wireRelayButtons();
  });
};

window.searchRelayTrack = async function() {
  const q  = document.getElementById('relaySearchInput').value.trim();
  if (!q) return;
  const el = document.getElementById('relay-results');
  el.innerHTML = '<div style="display:flex;justify-content:center;padding:12px"><div class="spinner"></div></div>';
  try {
    const r = await API.search(q);
    el.innerHTML = '';
    (r.tracks || []).slice(0, 6).forEach(t => {
      const item   = document.createElement('div');
      item.className = 'relay-result-item';
      const hasArt = t.albumArt && t.albumArt.startsWith('http');
      item.innerHTML =
        (hasArt
          ? '<img src="' + t.albumArt + '" alt="" onerror="this.style.display=\'none\'" />'
          : '<div style="width:34px;height:34px;background:var(--bg2);border-radius:4px;flex-shrink:0"></div>') +
        '<div><div class="relay-result-name">' + esc(t.name) + '</div><div class="relay-result-artist">' + esc(t.artist) + '</div></div>';
      item.onclick = () => selectRelayTrack(t);
      el.appendChild(item);
    });
  } catch(e) {
    el.innerHTML = '<p style="color:var(--accent);font-size:13px">' + e.message + '</p>';
  }
};

document.getElementById('relaySearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.searchRelayTrack();
});

async function selectRelayTrack(track) {
  document.getElementById('relay-results').innerHTML = '';
  document.getElementById('relay-selected').style.display = '';
  const artEl = document.getElementById('relay-sel-art');
  if (artEl) artEl.src = track.albumArt || '';
  document.getElementById('relay-sel-name').textContent   = track.name;
  document.getElementById('relay-sel-artist').textContent = track.artist;
  document.getElementById('relay-waveform').innerHTML = '<div class="tl-loading"><div class="spinner"></div> Downloading…</div>';

  showToast('Downloading relay: "' + track.name + '"…');
  const result = await API.downloadAudio(track.name, track.artist, null, track.previewUrl);
  if (result.error) { showToast('Relay download failed', 'error'); return; }

  if (result.thumbnailUrl && artEl) artEl.src = result.thumbnailUrl;

  relayConfig = {
    filename:    result.filename,
    audioUrl:    result.url,
    name:        track.name,
    artist:      track.artist,
    albumArt:    result.thumbnailUrl || track.albumArt,
    start:       0,
    end:         null,
    duration:    0,
    gapDuration: 0,
  };

  document.getElementById('relay-waveform').innerHTML = '';
  if (relayWS) { try { relayWS.destroy(); } catch(e) {} relayWS = null; }

  relayWS = WaveSurfer.create({
    container:     document.getElementById('relay-waveform'),
    ...wfColors(),
    barWidth: 2, barGap: 1, barRadius: 2, height: 72,
    url: result.url,
  });

  relayWS.on('ready', () => {
    relayConfig.duration = relayWS.getDuration();
    relayConfig.end      = relayConfig.duration;
    updateRelayUI();
    initRelayDrag();
    wireRelayButtons();
    document.getElementById('relay-confirm-btn').disabled = false;
  });

  relayWS.on('timeupdate', t => {
    if (relayConfig.end && t >= relayConfig.end) {
      relayWS.pause();
      relayWS.seekTo(relayConfig.end / relayConfig.duration);
    }
  });

  relayWS.on('play',  () => { document.getElementById('relay-play-btn').textContent = '⏸'; });
  relayWS.on('pause', () => { document.getElementById('relay-play-btn').textContent = '▶'; });
}

function wireRelayButtons() {
  const playBtn = document.getElementById('relay-play-btn');
  if (playBtn) playBtn.onclick = () => {
    if (!relayWS) return;
    if (relayWS.isPlaying()) { relayWS.pause(); return; }
    const t = relayWS.getCurrentTime();
    if (relayConfig.end && (t >= relayConfig.end || t < relayConfig.start)) {
      relayWS.seekTo(relayConfig.start / relayConfig.duration);
    }
    relayWS.play();
  };

  const mi = document.getElementById('relay-mark-in');
  const mo = document.getElementById('relay-mark-out');
  const mr = document.getElementById('relay-mark-reset');

  if (mi) mi.onclick = () => {
    const t = relayWS.getCurrentTime();
    if (t >= relayConfig.end) return;
    relayConfig.start = parseFloat(t.toFixed(3));
    relayWS.seekTo(relayConfig.start / relayConfig.duration);
    updateRelayUI();
    showToast('Relay in: ' + fmtTime(relayConfig.start), 'success');
  };
  if (mo) mo.onclick = () => {
    const t = relayWS.getCurrentTime();
    if (t <= relayConfig.start) return;
    relayConfig.end = parseFloat(t.toFixed(3));
    relayWS.seekTo(relayConfig.start / relayConfig.duration);
    updateRelayUI();
    showToast('Relay out: ' + fmtTime(relayConfig.end), 'success');
  };
  if (mr) mr.onclick = () => {
    relayConfig.start = 0;
    relayConfig.end   = relayConfig.duration;
    relayWS.seekTo(0);
    updateRelayUI();
  };

  const gs = document.getElementById('relayGapSlider');
  if (gs) gs.oninput = function() { updateGapUI(parseFloat(this.value)); };
}

function initRelayDrag() {
  const waveEl = document.getElementById('relay-waveform');
  if (!waveEl) return;
  waveEl.style.position = 'relative';

  // Remove old handles
  waveEl.querySelectorAll('.trim-shade, .trim-handle').forEach(el => el.remove());

  const sl = document.createElement('div');
  sl.className = 'trim-shade'; sl.id = 'r-sl';
  sl.style.cssText = 'left:0;width:0;pointer-events:none;z-index:3';

  const sr = document.createElement('div');
  sr.className = 'trim-shade'; sr.id = 'r-sr';
  sr.style.cssText = 'left:100%;width:0;pointer-events:none;z-index:3';

  const hs = document.createElement('div');
  hs.className = 'trim-handle'; hs.id = 'r-hs';
  hs.style.cssText = 'position:absolute;top:0;bottom:0;left:0;z-index:5;touch-action:none';

  const he = document.createElement('div');
  he.className = 'trim-handle'; he.id = 'r-he';
  he.style.cssText = 'position:absolute;top:0;bottom:0;z-index:5;touch-action:none;left:calc(100% - 12px)';

  waveEl.appendChild(sl);
  waveEl.appendChild(sr);
  waveEl.appendChild(hs);
  waveEl.appendChild(he);

  const pct = e => {
    const r = waveEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  hs.addEventListener('pointerdown', e => {
    e.preventDefault();
    hs.setPointerCapture(e.pointerId);
    const move = ev => {
      const t = pct(ev) * relayConfig.duration;
      if (t >= relayConfig.end - 0.5) return;
      relayConfig.start = parseFloat(t.toFixed(3));
      relayWS.seekTo(relayConfig.start / relayConfig.duration);
      updateRelayUI();
    };
    const up = () => { hs.removeEventListener('pointermove', move); hs.removeEventListener('pointerup', up); };
    hs.addEventListener('pointermove', move);
    hs.addEventListener('pointerup', up);
  });

  he.addEventListener('pointerdown', e => {
    e.preventDefault();
    he.setPointerCapture(e.pointerId);
    const move = ev => {
      const t = pct(ev) * relayConfig.duration;
      if (t <= relayConfig.start + 0.5) return;
      relayConfig.end = parseFloat(t.toFixed(3));
      relayWS.seekTo(relayConfig.start / relayConfig.duration);
      updateRelayUI();
    };
    const up = () => { he.removeEventListener('pointermove', move); he.removeEventListener('pointerup', up); };
    he.addEventListener('pointermove', move);
    he.addEventListener('pointerup', up);
  });
}

function updateRelayUI() {
  if (!relayConfig || !relayConfig.duration) return;
  const sp = (relayConfig.start / relayConfig.duration) * 100;
  const ep = ((relayConfig.end || relayConfig.duration) / relayConfig.duration) * 100;

  const sl = document.getElementById('r-sl');
  const sr = document.getElementById('r-sr');
  const hs = document.getElementById('r-hs');
  const he = document.getElementById('r-he');

  if (sl) { sl.style.left = '0';       sl.style.width = sp + '%'; }
  if (sr) { sr.style.left = ep + '%';  sr.style.width = (100 - ep) + '%'; }
  if (hs) hs.style.left = 'calc(' + sp + '% - 6px)';
  if (he) he.style.left = 'calc(' + ep + '% - 6px)';

  const td = document.getElementById('relay-time-disp');
  if (td) td.textContent = fmtTime(relayConfig.start) + ' → ' + (relayConfig.end ? fmtTime(relayConfig.end) : '—');

  const dd = document.getElementById('relay-dur-label');
  if (dd && relayConfig.end) dd.textContent = (relayConfig.end - relayConfig.start).toFixed(1) + 's';
}

function updateGapUI(v) {
  const gv = document.getElementById('relayGapVal');      if (gv) gv.textContent = v.toFixed(1) + 's';
  const gb = document.getElementById('gap-preview-before'); if (gb) gb.textContent = v === 0 ? '—' : v + 's 🔇';
  const ga = document.getElementById('gap-preview-after');  if (ga) ga.textContent = v === 0 ? '—' : v + 's 🔇';
}

window.confirmRelay = function() {
  const gapSlider = document.getElementById('relayGapSlider');
  if (relayConfig) relayConfig.gapDuration = gapSlider ? parseFloat(gapSlider.value) : 0;
  window.closeRelayPicker();
  document.getElementById('relay-position-opts').style.display = '';
  document.getElementById('editRelayBtn').style.display        = '';
  const st = document.getElementById('relay-status-text');
  if (st && relayConfig) {
    const dur    = ((relayConfig.end || relayConfig.duration) - relayConfig.start).toFixed(1);
    const gapTxt = relayConfig.gapDuration > 0 ? ' · ' + relayConfig.gapDuration + 's gap' : '';
    st.textContent = '🎵 ' + relayConfig.name + ' · ' + dur + 's' + gapTxt;
  }
  showToast('Relay set: ' + (relayConfig ? relayConfig.name : ''), 'success');
};

// ── Save Flow ──
document.getElementById('saveProjectBtn').onclick = () => {
  document.getElementById('saveModal').style.display = 'flex';
  const input = document.getElementById('projectNameInput');
  input.focus();
  input.select(); // Highlights the text so they can easily type over it
};

document.getElementById('confirmSaveBtn').onclick = async () => {
  const name = document.getElementById('projectNameInput').value.trim() || 'Untitled';
  document.getElementById('saveModal').style.display = 'none'; // Close modal
  
  const r = await API.saveProject({
    id:            currentProjectId,
    name,
    segments:      timeline.toJSON(),
    relayConfig:   buildRelayConfig(),
    transitionMode,
    fadeOptions:   getFadeOptions(),
  });
  
  if (r.project) {
    currentProjectId = r.project.id;
    showToast('Saved! 💾  Use 🔗 Share to open it on another device', 'success');
  }
};

// Loop toggle button
document.getElementById('loopBtn').onclick = () => timeline.toggleLoop();

// Share the current project (must be saved first so it has an id).
document.getElementById('shareProjectBtn').onclick = () => {
  if (!currentProjectId) { showToast('Save the project first to get a share link', 'error'); return; }
  copyShareLink(currentProjectId);
};

// ── Projects ──
let projectToDelete = null; // Remembers which project ID to delete

// Load a project's full state into the workspace (used by Edit, shared links).
function applyProject(p) {
  timeline.loadFromJSON(p.segments || []);
  if (p.relayConfig) {
    relayConfig = p.relayConfig;
    document.getElementById('relay-position-opts').style.display = '';
    document.getElementById('editRelayBtn').style.display         = '';
    const gs = document.getElementById('relayGapSlider');
    if (gs && relayConfig.gapDuration != null) { gs.value = relayConfig.gapDuration; updateGapUI(relayConfig.gapDuration); }
    const as = document.getElementById('relayAtStart'); if (as) as.checked = relayConfig.playAtStart !== false;
    const ae = document.getElementById('relayAtEnd');   if (ae) ae.checked = relayConfig.playAtEnd   !== false;
    const st = document.getElementById('relay-status-text');
    if (st) st.textContent = '🎵 ' + relayConfig.name + ' · ' + ((relayConfig.end || relayConfig.duration) - relayConfig.start).toFixed(1) + 's';
  }
  if (p.transitionMode) setTransitionMode(p.transitionMode);
  if (p.fadeOptions) {
    const fe = document.getElementById('fadeEnabled');
    if (fe) { fe.checked = !!p.fadeOptions.enabled; document.getElementById('fade-ctrl').style.display = fe.checked ? '' : 'none'; }
    const fi = document.getElementById('fadeInSlider');
    if (fi) { fi.value = p.fadeOptions.fadeInDuration || 1.5; document.getElementById('fadeInVal').textContent = fi.value + 's'; }
    const fo = document.getElementById('fadeOutSlider');
    if (fo) { fo.value = p.fadeOptions.fadeOutDuration || 1.5; document.getElementById('fadeOutVal').textContent = fo.value + 's'; }
  }
  currentProjectId = p.id;
  document.querySelector('[data-view="timeline"]').click();
}

// Build + copy a shareable link so another device/person can continue the project.
function shareLink(id) { return location.origin + '/app?project=' + encodeURIComponent(id); }
async function copyShareLink(id) {
  const link = shareLink(id);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Share link copied! 🔗 Anyone with it can continue this project', 'success');
  } catch (_) {
    window.prompt('Copy this share link:', link);
  }
}
window.copyShareLink = copyShareLink;

// Global delete confirmation handler
document.getElementById('confirmDeleteBtn').onclick = async () => {
  if (!projectToDelete) return;
  document.getElementById('deleteModal').style.display = 'none'; // Close modal
  await API.deleteProject(projectToDelete);
  projectToDelete = null;
  loadProjects(); // Refresh the grid
  showToast('Project deleted', 'success');
};

async function loadProjects() {
  const el = document.getElementById('projects-list');
  el.innerHTML = '<p style="color:var(--text2);font-size:14px">Loading…</p>';
  try {
    const { projects } = await API.listProjects();
    if (!projects || !projects.length) {
      el.innerHTML = '<p style="color:var(--text2);font-size:14px">No saved projects yet.</p>';
      return;
    }
    el.innerHTML = '';
    projects.forEach(p => {
      const card = document.createElement('div');
      card.className = 'proj-card';
      card.innerHTML =
        '<div class="proj-name">' + esc(p.name) + '</div>' +
        '<div class="proj-meta">' + p.segments.length + ' track' + (p.segments.length !== 1 ? 's' : '') + ' · ' + new Date(p.updatedAt).toLocaleDateString() + '</div>' +
        '<div class="proj-actions">' +
          '<button class="btn-proj btn-proj-load">✏️ Edit</button>' +
          '<button class="btn-proj btn-proj-share">🔗 Share</button>' +
          '<button class="btn-proj btn-proj-preview">▶ Preview</button>' +
          '<button class="btn-proj btn-proj-export">⬇ Export</button>' +
          '<button class="btn-proj btn-proj-del">🗑</button>' +
        '</div>';

      card.querySelector('.btn-proj-load').onclick = () => {
        applyProject(p);
        showToast('Loaded "' + p.name + '"', 'success');
      };

      card.querySelector('.btn-proj-share').onclick = () => copyShareLink(p.id);

      card.querySelector('.btn-proj-preview').onclick = () => {
        const segs = buildExportSegments(p.segments);
        if (!segs.length) { showToast('No audio in this project', 'error'); return; }
        // ✅ Updated to pass saved configs
        openPreview(segs, p.transitionMode, p.relayConfig, p.fadeOptions);
      };

      card.querySelector('.btn-proj-export').onclick = () => {
        const segs = buildExportSegments(p.segments);
        if (!segs.length) { showToast('No audio in this project', 'error'); return; }
        // ✅ Updated to pass saved configs
        runExport(segs, p.transitionMode, p.relayConfig, p.fadeOptions);
      };

      card.querySelector('.btn-proj-del').onclick = () => {
        // Instead of calling confirm(), we open our custom modal
        projectToDelete = p.id;
        document.getElementById('deleteConfirmText').textContent = 'Are you sure you want to delete "' + p.name + '"?';
        document.getElementById('deleteModal').style.display = 'flex';
      };

      el.appendChild(card);
    }); // End of forEach loop
    
  } catch(e) {
    el.innerHTML = '<p style="color:var(--accent);font-size:14px">Error: ' + e.message + '</p>';
  }
}

// ── Helpers ──
function fmtTime(sec) {
  if (!sec && sec !== 0) return '0:00';
  return Math.floor(sec / 60) + ':' + Math.floor(sec % 60).toString().padStart(2, '0');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Init ──
loadFeatured();

// If opened via a share link (?project=id), load that project into the workspace.
(async function loadSharedProject() {
  const pid = new URLSearchParams(location.search).get('project');
  if (!pid) return;
  try {
    const { project, error } = await API.getProject(pid);
    if (error || !project) { showToast('Shared project not found — it may have expired', 'error'); return; }
    applyProject(project);
    showToast('Opened shared project: "' + project.name + '"', 'success');
  } catch (e) {
    showToast('Could not load shared project', 'error');
  }
})();

// Note: no keep-alive ping — Fly.io scales the machine to zero when idle to
// stay cheap, and wakes it in seconds on the next request.

// ── Global keyboard shortcuts ──
// Space = play/pause · ←/→ = seek (Shift = fine) · I/O = mark in/out · R = reset · Del = remove · Esc = close
function isModalOpen(id) { return document.getElementById(id).style.display === 'flex'; }
function anyModalOpen() {
  return Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display === 'flex');
}

document.addEventListener('keydown', (e) => {
  const el  = e.target;
  const tag = (el.tagName || '').toLowerCase();

  // Cmd/Ctrl+S = Save (works even while focused in a field)
  if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (document.getElementById('view-timeline').classList.contains('active')) {
      document.getElementById('saveProjectBtn').click();
    }
    return;
  }

  if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return; // don't hijack typing

  // Esc closes any open modal + stops the preview
  if (e.key === 'Escape') {
    let closed = false;
    document.querySelectorAll('.modal-overlay').forEach(m => {
      if (m.style.display === 'flex') { m.style.display = 'none'; closed = true; }
    });
    if (previewWS) { try { previewWS.pause(); } catch (_) {} }
    if (closed) e.preventDefault();
    return;
  }

  // Space controls whichever player is in focus (preview or relay modal)
  if (isModalOpen('previewModal')) {
    if (e.key === ' ') { e.preventDefault(); if (previewWS) previewWS.playPause(); }
    return;
  }
  if (isModalOpen('relayModal')) {
    if (e.key === ' ' && relayWS) { e.preventDefault(); relayWS.isPlaying() ? relayWS.pause() : relayWS.play(); }
    return;
  }
  if (anyModalOpen()) return; // don't act behind save/delete/export modals

  // Timeline view shortcuts
  if (!document.getElementById('view-timeline').classList.contains('active')) return;

  switch (e.key) {
    case ' ':          e.preventDefault(); timeline.toggleActivePlay(); break;
    case 'ArrowRight': e.preventDefault(); timeline.seekActive(e.shiftKey ? 1 : 5);  break;
    case 'ArrowLeft':  e.preventDefault(); timeline.seekActive(e.shiftKey ? -1 : -5); break;
    case 'i': case 'I': timeline.markInActive();  break;
    case 'o': case 'O': timeline.markOutActive(); break;
    case 'r': case 'R': timeline.resetActive();   break;
    case 'l': case 'L': timeline.toggleLoop();    break;
    case 'Delete': case 'Backspace': e.preventDefault(); timeline.removeActive(); break;
  }
});