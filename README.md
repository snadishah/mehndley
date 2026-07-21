<div align="center">

# 🥁 Mehndley — Desi Wedding Medley Maker

**One medley. Every song of the night.**

Turn your favourite Bollywood, Punjabi and Desi songs into a single seamless wedding medley — search, trim the parts you love, blend them with crossfades or a dhol hook, and export one clean MP3. All in your browser.

🔗 **Live:** [mehndley.fly.dev](https://mehndley.fly.dev) &nbsp;·&nbsp; 📖 **Guides:** [/guides](https://mehndley.fly.dev/guides)

</div>

---

## ✨ Features

- 🔎 **Search** any Bollywood / Punjabi / Desi track — fast, with album art
- ✂️ **Trim** each song to the exact part you want, right on the waveform (click/drag to scrub, mark in/out)
- 🌊 **Crossfade** transitions, or a **relay hook** — a dhol pattern between songs, with optional silence gaps
- 🎚️ **Automatic loudness normalization** (EBU R128 / −16 LUFS) so no song is suddenly too loud or too quiet
- 🎧 **Live preview** with real-time render progress streamed from the server, then **export** a single 320 kbps MP3
- 💾 **Save & share** projects via a link — collaborate across devices, no login required
- ⌨️ Full **keyboard shortcuts** — space to play, arrows to seek, I/O to mark in/out, and more
- 📱 **Responsive** and touch-friendly, with **PWA** "add to home screen" support
- 🌗 Monochrome **light/dark** theme

---

## 🧰 Tech Stack

### Languages
| Language | Where it's used |
|---|---|
| **JavaScript (ES2020+)** | Both the Node.js backend and the vanilla-JS frontend |
| **HTML5** | Landing page, app shell, guide/blog pages |
| **CSS3** | Custom design system (CSS variables, grid/flexbox, no framework) |

### Backend
- **[Node.js](https://nodejs.org/)** — runtime
- **[Express.js](https://expressjs.com/)** — HTTP server, routing, static hosting
- **[FFmpeg](https://ffmpeg.org/)** — all audio processing: a single-pass `filter_complex` graph handles trimming, fades, crossfades, the relay/silence sequencing, loudness normalization and concatenation in one render
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — fetches source audio (self-updates in the background so it doesn't go stale)
- **Server-Sent Events (SSE)** — streams live ffmpeg render progress to the browser
- **JSON file store** on a persistent volume — projects with per-workspace scoping and unguessable share IDs (no database needed)

### Frontend
- **Vanilla JavaScript** — no framework; a small hand-rolled module structure (`api.js`, `timeline.js`, `app.js`)
- **[WaveSurfer.js](https://wavesurfer.xyz/)** — waveform rendering, playback and scrubbing
- **PWA** — web manifest + icons for installability

### External APIs
- **[iTunes Search API](https://performance-partners.apple.com/search-api)** — keyless, fast song search with album art and preview URLs

### Infrastructure & Ops
- **[Docker](https://www.docker.com/)** — image bundles Node, FFmpeg and yt-dlp
- **[Fly.io](https://fly.io/)** — deployment (Singapore region), scale-to-zero, persistent volume, auto-HTTPS
- **SEO** — `robots.txt`, `sitemap.xml`, JSON-LD structured data (`WebApplication`, `FAQPage`, `HowTo`), Open Graph / Twitter cards

---

## 📁 Project structure

```
mehndi-mixer/
├── backend/
│   ├── server.js              # Express app, static hosting, cleanup, yt-dlp refresh
│   ├── config.js              # storage paths (maps to the Fly volume in prod)
│   ├── routes/                # spotify (search), audio, projects
│   └── controllers/
│       ├── spotifyController.js   # iTunes search
│       ├── audioController.js      # yt-dlp download + single-pass ffmpeg mixing (SSE)
│       └── projectsController.js   # per-workspace project storage
├── frontend/
│   ├── index.html             # landing page
│   ├── app.html               # the mixer app
│   ├── guides/                # SEO guide/blog pages
│   ├── css/style.css          # full design system
│   └── js/                    # api.js, timeline.js, app.js
├── Dockerfile
├── fly.toml
└── package.json
```

---

## 🚀 Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Requires **FFmpeg** and **yt-dlp** installed on your machine (or just build the included `Dockerfile`, which bundles both).

## ☁️ Deploy (Fly.io)

```bash
fly launch --no-deploy
fly volumes create mehndley_data --size 2 --region sin
fly deploy --ha=false
```

---

## ⚖️ Disclaimer

Mehndley is a personal tool for making medleys for your own private events. It doesn't host any music — all songs belong to their respective artists and rights holders. **For personal, non-commercial use only.** Please support the original creators.

---

<div align="center">

Built after making my cousin's mehndi medley by hand at 4am. Never again. 💛

</div>
