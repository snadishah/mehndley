const https = require('https');

// ── Tiny JSON fetcher with redirect + timeout handling ──
function fetchJSON(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'MehndiMixer/1.0', 'Accept': 'application/json' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('JSON parse error')); } });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Curated Desi songs for the featured/browse page.
const FEATURED = [
  { name: 'Pasoori', artist: 'Ali Sethi' },
  { name: 'Kahani Suno 2.0', artist: 'Kaifi Khalil' },
  { name: 'Tum Hi Ho', artist: 'Arijit Singh' },
  { name: 'Kesariya', artist: 'Arijit Singh' },
  { name: 'Excuses', artist: 'AP Dhillon' },
  { name: 'With You', artist: 'AP Dhillon' },
  { name: 'Brown Munde', artist: 'AP Dhillon' },
  { name: 'Lover', artist: 'Diljit Dosanjh' },
  { name: 'Gallan Goodiyaan', artist: 'Various' },
  { name: 'Dil Diyan Gallan', artist: 'Atif Aslam' },
  { name: 'Sajni', artist: 'Arijit Singh' },
  { name: 'Nachde Ne Saare', artist: 'Jasleen Royal' },
  { name: 'Morni Banke', artist: 'Guru Randhawa' },
  { name: 'Ve Maahi', artist: 'Arijit Singh' },
];

// Upgrade iTunes artwork from the default 100x100 to a crisp 400x400.
function bigArt(url) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/, '/400x400bb.$1');
}

function mapTrack(item, idx) {
  return {
    id: (item.trackId ? 'itunes_' + item.trackId : 'track_' + idx + '_' + Date.now()),
    name: item.trackName || '',
    artist: item.artistName || '',
    albumArt: bigArt(item.artworkUrl100),
    // 30s preview stream — lets the UI play instantly with no download.
    previewUrl: item.previewUrl || null,
    duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0,
  };
}

// One iTunes Search API call. No key, no auth, ~200-400ms, returns art + preview.
async function itunesSearch(term, limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
  const data = await fetchJSON(url);
  const results = Array.isArray(data && data.results) ? data.results : [];
  return results.map(mapTrack);
}

class MusicController {
  async search(req, res) {
    try {
      const q = req.query.q;
      const featured = req.query.featured === '1';

      if (featured) {
        // Fetch each curated song in parallel — fast because iTunes is ~300ms/call.
        const settled = await Promise.all(
          FEATURED.map(async (song) => {
            try {
              const hits = await itunesSearch(`${song.name} ${song.artist}`, 1);
              return hits[0] || null;
            } catch (_) { return null; }
          })
        );
        const tracks = settled.filter(Boolean);
        // Light shuffle so the page feels fresh on each visit.
        tracks.sort(() => Math.random() - 0.5);
        return res.json({ tracks });
      }

      if (!q) return res.status(400).json({ error: 'Query required' });

      const tracks = await itunesSearch(q, 24);
      res.json({ tracks });
    } catch (err) {
      console.error('Search error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }

  // Kept as lightweight stubs — also serve as the keep-alive ping target.
  async getAudioFeatures(req, res) {
    const ids = (req.query.ids || '').split(',');
    res.json({ features: ids.map(id => ({ id, bpm: null, danceability: null })) });
  }

  async getSuggestions(req, res) {
    res.json({ suggestions: [], sourceBpm: null });
  }
}

module.exports = new MusicController();
