// Theme-aware waveform colors so waveforms stay visible in BOTH light and dark.
function wfColors() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return light
    ? { waveColor: 'rgba(0,0,0,0.18)',  progressColor: 'rgba(0,0,0,0.72)',     cursorColor: 'rgba(0,0,0,0.5)' }
    : { waveColor: 'rgba(255,255,255,0.16)', progressColor: 'rgba(255,255,255,0.85)', cursorColor: 'rgba(255,255,255,0.55)' };
}

class Timeline {
  constructor() {
    this.segments = [];
    this.wavesurfers = {};
    this.activeId = null;   // the track keyboard shortcuts act on
    this.loop = false;      // loop the trimmed section during playback
    this._dragId = null;    // track being drag-reordered
  }

  // ── Drag-to-reorder (pointer-based — works on desktop AND touch) ──
  _afterElement(container, y) {
    const els = Array.from(container.querySelectorAll('.tl-card:not(.dragging)'));
    let closest = { offset: -Infinity, element: null };
    for (const child of els) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
    }
    return closest.element;
  }

  _syncOrderFromDOM() {
    const tracks = document.getElementById('timeline-tracks');
    if (!tracks) return;
    const order = Array.from(tracks.querySelectorAll('.tl-card')).map(c => c.dataset.segId);
    this.segments.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    this._updateHeader();
  }

  _wireDrag(seg) {
    const card = this._card(seg.id);
    if (!card || card.dataset.dragWired) return;
    card.dataset.dragWired = '1';
    const grip = card.querySelector('.tl-grip');
    if (!grip) return;
    grip.style.touchAction = 'none'; // stop the page scrolling while dragging on touch

    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const tracks = document.getElementById('timeline-tracks');
      if (!tracks) return;
      card.classList.add('dragging');
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}

      const move = (ev) => {
        const after = this._afterElement(tracks, ev.clientY);
        if (after == null) tracks.appendChild(card);
        else if (after !== card) tracks.insertBefore(card, after);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        card.classList.remove('dragging');
        this._syncOrderFromDOM();
        showToast('Reordered');
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  // ── Active track + playback control ──
  setActive(id) {
    this.activeId = id;
    document.querySelectorAll('.tl-card.active').forEach(c => c.classList.remove('active'));
    const card = this._card(id);
    if (card) card.classList.add('active');
  }

  // Active track if it has audio, else the first playable one.
  getActive() {
    let seg = this.segments.find(s => s.id === this.activeId && s.audioUrl);
    if (!seg) seg = this.segments.find(s => s.audioUrl);
    return seg || null;
  }

  // Pause every other track so only one plays at a time.
  _pauseOthers(exceptId) {
    Object.keys(this.wavesurfers).forEach(id => {
      if (id === exceptId) return;
      try { if (this.wavesurfers[id].isPlaying()) this.wavesurfers[id].pause(); } catch (_) {}
    });
  }

  // Smart play/pause that respects the trim in/out points.
  togglePlay(seg) {
    const ws = this.wavesurfers[seg.id];
    if (!ws) return;
    if (ws.isPlaying()) { ws.pause(); return; }
    this._pauseOthers(seg.id);
    this.setActive(seg.id);
    if (seg.duration) {
      const t = ws.getCurrentTime();
      if (t < seg.start || (seg.end && t >= seg.end)) {
        ws.seekTo(this._clamp(seg.start / seg.duration));
      }
    }
    ws.play();
  }

  toggleActivePlay() {
    const seg = this.getActive();
    if (!seg) { showToast('Add a track first', 'error'); return; }
    this.setActive(seg.id);
    this.togglePlay(seg);
  }

  seekActive(delta) {
    const seg = this.getActive();
    if (!seg) return;
    const ws = this.wavesurfers[seg.id];
    if (!ws || !seg.duration) return;
    const lo = seg.start || 0;
    const hi = seg.end || seg.duration;
    let t = ws.getCurrentTime() + delta;
    t = Math.max(lo, Math.min(hi, t));
    ws.seekTo(this._clamp(t / seg.duration));
  }

  markIn(seg) {
    const ws = this.wavesurfers[seg.id];
    if (!ws) return;
    const t = ws.getCurrentTime();
    if (seg.end && t >= seg.end) return;
    seg.start = parseFloat(t.toFixed(3));
    this._updateOverlay(seg);
    showToast('In: ' + this._fmt(seg.start), 'success');
  }

  markOut(seg) {
    const ws = this.wavesurfers[seg.id];
    if (!ws) return;
    const t = ws.getCurrentTime();
    if (t <= seg.start) return;
    seg.end = parseFloat(t.toFixed(3));
    this._updateOverlay(seg);
    showToast('Out: ' + this._fmt(seg.end), 'success');
  }

  resetTrim(seg) {
    const ws = this.wavesurfers[seg.id];
    seg.start = 0;
    seg.end = seg.duration;
    if (ws) ws.seekTo(0);
    this._updateOverlay(seg);
    showToast('Trim reset');
  }

  markInActive()  { const s = this.getActive(); if (s) this.markIn(s); }
  markOutActive() { const s = this.getActive(); if (s) this.markOut(s); }
  resetActive()   { const s = this.getActive(); if (s) this.resetTrim(s); }
  removeActive()  { const s = this.getActive(); if (s) this.remove(s.id); }

  add(track) {
    if (this.segments.find(s => s.name === track.name && s.artist === track.artist)) {
      showToast('Already in timeline!', 'error');
      return false;
    }
    const seg = {
      id:       'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name:     track.name     || 'Unknown',
      artist:   track.artist   || '',
      albumArt: track.albumArt || null,
      filename: null,
      audioUrl: null,
      start:    0,
      end:      null,   // null = full track, set to duration once waveform loads
      duration: 0,
    };
    this.segments.push(seg);
    return seg;
  }

  remove(id) {
    this._destroyWS(id);
    this.segments = this.segments.filter(s => s.id !== id);
    this.fullRender();
  }

  move(id, dir) {
    const i = this.segments.findIndex(s => s.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= this.segments.length) return;
    [this.segments[i], this.segments[j]] = [this.segments[j], this.segments[i]];
    // Reorder DOM without destroying waveforms
    const tracksEl = document.getElementById('timeline-tracks');
    this.segments.forEach(seg => {
      const card = this._card(seg.id);
      if (card) tracksEl.appendChild(card);
    });
    this._updateHeader();
  }

  updateSegmentAudio(id) {
    const seg = this.segments.find(s => s.id === id);
    if (!seg || !seg.audioUrl) return;
    const card = this._card(id);
    if (!card) { this.fullRender(); return; }
    const loading = card.querySelector('.tl-loading');
    if (loading) loading.outerHTML = this._playerHTML(seg);
    this._wireCardButtons(seg);
    requestAnimationFrame(() => this._initWaveform(seg));
    this._updateHeader();
  }

  fullRender() {
    const tracksEl = document.getElementById('timeline-tracks');
    this._toggleWorkspace(this.segments.length > 0);
    if (!this.segments.length) { tracksEl.innerHTML = ''; return; }

    // Add any missing cards, move existing ones to preserve order
    this.segments.forEach(seg => {
      let card = this._card(seg.id);
      if (!card) {
        card = this._buildCard(seg);
        this._wireCardButtons(seg);
      }
      tracksEl.appendChild(card); // append = move to end, preserving content
      if (seg.audioUrl && !this.wavesurfers[seg.id]) {
        requestAnimationFrame(() => this._initWaveform(seg));
      }
    });

    // Remove cards no longer in segments
    Array.from(tracksEl.querySelectorAll('.tl-card')).forEach(card => {
      if (!this.segments.find(s => s.id === card.dataset.segId)) card.remove();
    });

    this._updateHeader();
  }

  render() {
    const tracksEl = document.getElementById('timeline-tracks');
    this._toggleWorkspace(this.segments.length > 0);
    if (!this.segments.length) return;
    this.segments.forEach(seg => {
      if (!this._card(seg.id)) {
        const card = this._buildCard(seg);
        tracksEl.appendChild(card);
        this._wireCardButtons(seg);
        if (seg.audioUrl) requestAnimationFrame(() => this._initWaveform(seg));
      }
    });
    this._updateHeader();
  }

  loadFromJSON(segs) {
    Object.keys(this.wavesurfers).forEach(id => this._destroyWS(id));
    this.segments = segs.map(s => Object.assign({}, s));
    document.getElementById('timeline-tracks').innerHTML = '';
    this.fullRender();
  }

  // Returns export-safe segments — handles null end and zero duration gracefully
  getExportData(crossfadeDuration) {
    return {
      segments: this.segments.map(s => ({
        filename:  s.filename,
        start:     s.start || 0,
        // If end is null or 0, use duration. If duration is also 0, use a large number
        // and let FFmpeg handle it (it will just use the full file)
        end:       s.end && s.end > 0 ? s.end : (s.duration > 0 ? s.duration : 99999),
        trackName: s.name,
      })),
      crossfadeDuration,
    };
  }

  toJSON() { return this.segments.map(s => Object.assign({}, s)); }

  // ── DOM builders ──

  _buildCard(seg) {
    const div = document.createElement('div');
    div.className = 'tl-card';
    div.dataset.segId = seg.id;

    const artHTML = (seg.albumArt && seg.albumArt.startsWith('http'))
      ? `<div class="tl-art"><img src="${seg.albumArt}" alt="" onerror="this.parentElement.innerHTML='🎵'" /></div>`
      : `<div class="tl-art">🎵</div>`;

    div.innerHTML = `
      <div class="tl-head">
        <span class="tl-grip" title="Drag to reorder">⠿</span>
        ${artHTML}
        <div class="tl-meta">
          <div class="tl-name">${this._esc(seg.name)}</div>
          <div class="tl-artist">${this._esc(seg.artist)}</div>
        </div>
        <div class="tl-btns">
          <button class="tl-btn up-btn"   title="Move up">↑</button>
          <button class="tl-btn down-btn" title="Move down">↓</button>
          <button class="tl-btn danger rem-btn" title="Remove">✕</button>
        </div>
      </div>
      ${seg.audioUrl
        ? this._playerHTML(seg)
        : `<div class="tl-loading"><div class="spinner"></div> Downloading audio…</div>`}
    `;
    return div;
  }

  _playerHTML(seg) {
    return `
      <div class="tl-player">
        <button class="tl-playbtn" id="play-${seg.id}">▶</button>
        <div class="tl-timecode">
          <span id="curr-${seg.id}">0:00</span>
          <span style="color:var(--text3)"> / </span>
          <span id="tot-${seg.id}">—</span>
        </div>
        <div class="tl-pills">
          <span class="pill pill-in"  id="in-${seg.id}">IN  0:00</span>
          <span class="pill pill-out" id="out-${seg.id}">OUT —</span>
          <span class="pill pill-dur" id="dur-${seg.id}">—</span>
        </div>
      </div>
      <div class="tl-wave-wrap">
        <div class="tl-wave-host" id="wh-${seg.id}">
          <div id="wf-${seg.id}" class="wf-el"></div>
          <div class="trim-shade" id="sl-${seg.id}" style="left:0;width:0"></div>
          <div class="trim-shade" id="sr-${seg.id}" style="left:100%;width:0"></div>
          <div class="trim-handle" id="hl-${seg.id}" title="Drag to set start point"></div>
          <div class="trim-handle" id="hr-${seg.id}" title="Drag to set end point" style="left:calc(100% - 12px)"></div>
        </div>
      </div>
      <div class="tl-marks">
        <button class="mark-btn mark-in"    id="mi-${seg.id}">⬅ Mark In</button>
        <button class="mark-btn mark-out"   id="mo-${seg.id}">Mark Out ➡</button>
        <button class="mark-btn mark-reset" id="mr-${seg.id}">↺ Reset</button>
        <span class="mark-hint">Play → pause at cut point → Mark In / Mark Out</span>
      </div>
    `;
  }

  _wireCardButtons(seg) {
    const card = this._card(seg.id);
    if (!card) return;
    // Clicking anywhere on the card (except a button) makes it the active track.
    if (!card.dataset.clickWired) {
      card.dataset.clickWired = '1';
      card.addEventListener('click', e => { if (!e.target.closest('button')) this.setActive(seg.id); });
    }
    const up  = card.querySelector('.up-btn');
    const dn  = card.querySelector('.down-btn');
    const rm  = card.querySelector('.rem-btn');
    if (up) up.onclick = () => this.move(seg.id, 'up');
    if (dn) dn.onclick = () => this.move(seg.id, 'down');
    if (rm) rm.onclick = () => this.remove(seg.id);
    this._wireDrag(seg);
  }

  // ── WaveSurfer ──

  _initWaveform(seg) {
    if (this.wavesurfers[seg.id]) return;
    const container = document.getElementById(`wf-${seg.id}`);
    if (!container) { console.warn('[TL] container missing for', seg.id); return; }

    const ws = WaveSurfer.create({
      container,
      ...wfColors(),
      cursorWidth:   2,
      barWidth:      2,
      barGap:        1,
      barRadius:     2,
      height:        80,
      url:           seg.audioUrl,
      interact:      false,   // we handle click/drag seeking ourselves (precise + reliable)
    });

    this.wavesurfers[seg.id] = ws;

    ws.on('ready', () => {
      seg.duration = ws.getDuration();
      // Only set end if it hasn't been set yet (null) or is invalid
      if (!seg.end || seg.end <= 0 || seg.end > seg.duration) {
        seg.end = seg.duration;
      }
      if (seg.start >= seg.duration) seg.start = 0;

      const totEl = document.getElementById(`tot-${seg.id}`);
      if (totEl) totEl.textContent = this._fmt(seg.duration);

      this._updateOverlay(seg);
      this._initDrag(seg, ws);
      this._initSeek(seg, ws);
      this._updateHeader();
    });

    ws.on('timeupdate', t => {
      const el = document.getElementById(`curr-${seg.id}`);
      if (el) el.textContent = this._fmt(t);
      if (seg.end && t >= seg.end) {
        if (this.loop && ws.isPlaying()) {
          // Loop the trimmed section instead of stopping.
          ws.seekTo(this._clamp(seg.start / seg.duration));
        } else {
          ws.pause();
          ws.seekTo(this._clamp(seg.end / seg.duration));
          this._setPlayIcon(seg.id, false);
        }
      }
    });

    ws.on('play',   () => { this._pauseOthers(seg.id); this.setActive(seg.id); this._setPlayIcon(seg.id, true);  this._card(seg.id)?.classList.add('playing'); });
    ws.on('pause',  () => { this._setPlayIcon(seg.id, false); this._card(seg.id)?.classList.remove('playing'); });
    ws.on('finish', () => { this._setPlayIcon(seg.id, false); this._card(seg.id)?.classList.remove('playing'); });
    ws.on('error',  e  => console.error('[WS error]', seg.name, e));

    // Clicking the waveform (to seek) makes this the active track.
    ws.on('interaction', () => this.setActive(seg.id));

    // Play button — smart play/pause via shared method
    const playBtn = document.getElementById(`play-${seg.id}`);
    if (playBtn) playBtn.onclick = () => this.togglePlay(seg);

    // Mark In / Out / Reset — shared methods (also driven by keyboard)
    const mi = document.getElementById(`mi-${seg.id}`);
    if (mi) mi.onclick = () => this.markIn(seg);
    const mo = document.getElementById(`mo-${seg.id}`);
    if (mo) mo.onclick = () => this.markOut(seg);
    const mr = document.getElementById(`mr-${seg.id}`);
    if (mr) mr.onclick = () => this.resetTrim(seg);
  }

  // ── Click / drag to seek (precise, so playback always resumes from cursor) ──
  _initSeek(seg, ws) {
    const host = document.getElementById(`wh-${seg.id}`);
    if (!host || host.dataset.seekWired) return;
    host.dataset.seekWired = '1';

    const seekToEvent = (e) => {
      const r = host.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      ws.seekTo(frac);
      const el = document.getElementById(`curr-${seg.id}`);
      if (el) el.textContent = this._fmt(frac * seg.duration);
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.trim-handle')) return; // trim handles manage themselves
      this.setActive(seg.id);
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
      seekToEvent(e);
      const move = ev => seekToEvent(ev);              // drag = scrub
      const up = () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); };
      host.addEventListener('pointermove', move);
      host.addEventListener('pointerup', up);
    });
  }

  toggleLoop() {
    this.loop = !this.loop;
    const btn = document.getElementById('loopBtn');
    if (btn) btn.classList.toggle('active', this.loop);
    showToast(this.loop ? 'Loop on 🔁' : 'Loop off');
  }

  // ── Drag handles ──

  _initDrag(seg, ws) {
    const host = document.getElementById(`wh-${seg.id}`);
    const hl   = document.getElementById(`hl-${seg.id}`);
    const hr   = document.getElementById(`hr-${seg.id}`);
    if (!host || !hl || !hr) return;

    const pct = e => {
      const r = host.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };

    // Left handle — in-point
    hl.addEventListener('pointerdown', e => {
      e.preventDefault();
      hl.setPointerCapture(e.pointerId);
      const move = ev => {
        const t = pct(ev) * seg.duration;
        if (t >= (seg.end - 0.5)) return;
        seg.start = parseFloat(t.toFixed(3));
        ws.seekTo(this._clamp(seg.start / seg.duration));
        this._updateOverlay(seg);
      };
      const up = () => { hl.removeEventListener('pointermove', move); hl.removeEventListener('pointerup', up); };
      hl.addEventListener('pointermove', move);
      hl.addEventListener('pointerup', up);
    });

    // Right handle — out-point
    hr.addEventListener('pointerdown', e => {
      e.preventDefault();
      hr.setPointerCapture(e.pointerId);
      const move = ev => {
        const t = pct(ev) * seg.duration;
        if (t <= (seg.start + 0.5)) return;
        seg.end = parseFloat(t.toFixed(3));
        ws.seekTo(this._clamp(seg.start / seg.duration));
        this._updateOverlay(seg);
      };
      const up = () => { hr.removeEventListener('pointermove', move); hr.removeEventListener('pointerup', up); };
      hr.addEventListener('pointermove', move);
      hr.addEventListener('pointerup', up);
    });
  }

  // ── Overlay ──

  _updateOverlay(seg) {
    if (!seg.duration) return;
    const sp = (seg.start / seg.duration) * 100;
    const ep = ((seg.end ?? seg.duration) / seg.duration) * 100;

    const sl = document.getElementById(`sl-${seg.id}`);
    const sr = document.getElementById(`sr-${seg.id}`);
    const hl = document.getElementById(`hl-${seg.id}`);
    const hr = document.getElementById(`hr-${seg.id}`);

    if (sl) { sl.style.left = '0';       sl.style.width = sp + '%'; }
    if (sr) { sr.style.left = ep + '%';  sr.style.width = (100 - ep) + '%'; }
    if (hl) hl.style.left = `calc(${sp}% - 6px)`;
    if (hr) hr.style.left = `calc(${ep}% - 6px)`;

    const inEl  = document.getElementById(`in-${seg.id}`);
    const outEl = document.getElementById(`out-${seg.id}`);
    const durEl = document.getElementById(`dur-${seg.id}`);
    if (inEl)  inEl.textContent  = 'IN '  + this._fmt(seg.start);
    if (outEl) outEl.textContent = 'OUT ' + this._fmt(seg.end ?? seg.duration);
    if (durEl) durEl.textContent = ((seg.end ?? seg.duration) - seg.start).toFixed(1) + 's';

    this._updateHeader();
  }

  // ── Helpers ──

  _toggleWorkspace(show) {
    const empty = document.getElementById('timeline-empty');
    const ws    = document.getElementById('timeline-workspace');
    const exp   = document.getElementById('exportTimelineBtn');
    const prev  = document.getElementById('previewAllBtn');
    if (empty) empty.style.display = show ? 'none' : '';
    if (ws)    ws.style.display    = show ? ''     : 'none';
    if (exp)   exp.disabled        = !show;
    if (prev)  prev.disabled       = !show;
  }

  _updateHeader() {
    const n = this.segments.length;
    const badge   = document.getElementById('trackCount');
    const countEl = document.getElementById('tl-count');
    const durEl   = document.getElementById('tl-dur');

    if (badge)   { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
    if (countEl) countEl.textContent = n + ' track' + (n !== 1 ? 's' : '');
    if (durEl) {
      const total = this.segments.reduce((sum, s) => {
        const end = s.end && s.end > 0 ? s.end : s.duration;
        return sum + Math.max(0, end - (s.start || 0));
      }, 0);
      durEl.textContent = this._fmt(total) + ' total';
    }
  }

  _card(id)          { return document.querySelector(`[data-seg-id="${id}"]`); }
  _setPlayIcon(id,p) { const b = document.getElementById(`play-${id}`); if (b) b.textContent = p ? '⏸' : '▶'; }
  _clamp(p)          { return Math.max(0, Math.min(1, p)); }
  _destroyWS(id)     { if (this.wavesurfers[id]) { try { this.wavesurfers[id].destroy(); } catch(_){} delete this.wavesurfers[id]; } }

  _fmt(sec) {
    if (sec == null || isNaN(sec)) return '0:00';
    return Math.floor(sec / 60) + ':' + Math.floor(sec % 60).toString().padStart(2, '0');
  }

  _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

const timeline = new Timeline();