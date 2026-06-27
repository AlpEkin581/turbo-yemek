FROM node:20-bookworm-slim

# yt-dlp icin python ve ffmpeg kuruyoruz
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp'yi dogrudan binary olarak kuruyoruz (pip yerine - daha guncel ve stabil)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Gecici dosyalar icin klasor
RUN mkdir -p /app/tmp

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
