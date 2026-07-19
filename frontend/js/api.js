// Anonymous per-browser workspace id — keeps your projects private without a login.
const MM_OWNER = (() => {
  try {
    let id = localStorage.getItem('mm-owner');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
         : 'o_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      localStorage.setItem('mm-owner', id);
    }
    return id;
  } catch (_) { return 'anon'; }
})();

const API = {
  async search(query) {
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
    return res.json();
  },
  async getFeatured() {
    const res = await fetch('/api/spotify/search?featured=1');
    return res.json();
  },
  async getFeatures(ids) {
    const res = await fetch(`/api/spotify/features?ids=${ids.join(',')}`);
    return res.json();
  },
  async downloadAudio(trackName, artistName, youtubeId) {
    const res = await fetch('/api/audio/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackName, artistName, youtubeId }),
    });
    return res.json();
  },
  // Streams live ffmpeg progress (Server-Sent Events over the POST response).
  // onProgress(percent) is called as the render advances; resolves with the result.
  async mix(segments, crossfadeDuration, relayConfig, fadeOptions, onProgress) {
    const res = await fetch('/api/audio/mix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, crossfadeDuration, relayConfig, fadeOptions }),
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      // Validation error (or a proxy that buffered) — fall back to JSON.
      const j = await res.json().catch(() => ({ error: 'Mix failed' }));
      if (j.error) return j;
      return j;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, sep).trim();
        buf = buf.slice(sep + 2);
        if (!frame.startsWith('data:')) continue;
        let data;
        try { data = JSON.parse(frame.slice(5).trim()); } catch (_) { continue; }
        if (data.error)  return { error: data.error };
        if (data.done)   result = data;
        else if (typeof data.percent === 'number' && onProgress) onProgress(data.percent);
      }
    }
    return result || { error: 'Mix ended without a result' };
  },
  async listProjects() {
    const res = await fetch('/api/projects', { headers: { 'X-Owner': MM_OWNER } });
    return res.json();
  },
  async getProject(id) {
    const res = await fetch('/api/projects/' + encodeURIComponent(id));
    return res.json();
  },
  async saveProject(data) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner': MM_OWNER },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async deleteProject(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: { 'X-Owner': MM_OWNER } });
    return res.json();
  },
};