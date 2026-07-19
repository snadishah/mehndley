# 🥁 Mehndley — Desi Wedding Medley Maker

**One medley. Every song of the night.**

Mehndley turns your favourite Bollywood, Punjabi and Desi songs into a single seamless wedding medley — search, trim the parts you love, blend them, and export one clean MP3. All in your browser.

🔗 **Live:** [mehndley.fly.dev](https://mehndley.fly.dev) · 📖 **Guides:** [/guides](https://mehndley.fly.dev/guides)

---

## ✨ Features

- 🔎 **Search** any Bollywood / Punjabi / Desi track (iTunes Search API — fast, with album art)
- ✂️ **Trim** each song to the exact part you want, right on the waveform (click/drag to scrub, mark in/out)
- 🌊 **Crossfade** transitions, or a **relay hook** (a dhol pattern between songs, with optional silence gaps)
- 🎚️ **Automatic loudness normalization** (EBU R128) so no song is suddenly too loud or too quiet
- 🎧 **Live preview** with real-time render progress, then **export** a single 320 kbps MP3
- 💾 **Save & share** projects via a link — collaborate across devices, no login
- ⌨️ Full **keyboard shortcuts** (space to play, arrows to seek, I/O to mark, and more)
- 📱 **Responsive** — works on phones too
- 🌗 Monochrome **light/dark** theme

## 🛠️ Tech

- **Backend:** Node.js + Express, `yt-dlp` for audio, `ffmpeg` single-pass `filter_complex` mixing (SSE progress streaming)
- **Frontend:** Vanilla JS + [WaveSurfer.js](https://wavesurfer.xyz/)
- **Storage:** JSON file store on a persistent volume (per-workspace scoping, unguessable share IDs)
- **Deploy:** Docker on [Fly.io](https://fly.io) (Singapore), scale-to-zero

## 🚀 Run locally

```bash
npm install
npm start
# open http://localhost:3000
```
Requires `ffmpeg` and `yt-dlp` installed locally (or run via the included `Dockerfile`).

## ⚖️ Disclaimer

Mehndley is a personal tool for making medleys for your own private events. It doesn't host any music — all songs belong to their respective artists and rights holders. For personal, non-commercial use only. Please support the original creators.

---

Built after making my cousin's mehndi medley by hand at 4am. Never again. 💛
