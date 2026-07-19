# Use an official Node runtime (Bookworm ships Python 3.11 — yt-dlp needs >=3.10)
FROM node:20-bookworm-slim

# Install FFmpeg, Python (for yt-dlp), and wget
RUN apt-get update && \
    apt-get install -y ffmpeg python3 wget ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Download and install yt-dlp
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Set the working directory
WORKDIR /usr/src/app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Runtime config
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV PORT=3000
# Persistent storage root — mapped to a Fly volume (see fly.toml)
ENV MM_STORAGE=/data

# Create the storage mount point
RUN mkdir -p /data/uploads /data/output /data/data

EXPOSE 3000

# Start the server directly. (yt-dlp is fetched fresh at build time; updating on
# every boot would slow cold-starts and delay the port from opening.)
CMD ["node", "backend/server.js"]
