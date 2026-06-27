FROM node:20-bookworm-slim

# yt-dlp ve whisper.cpp derlemesi icin gerekli araclari kuruyoruz
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    git \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp'yi dogrudan binary olarak kuruyoruz (pip yerine - daha guncel ve stabil)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# whisper.cpp'yi kaynaktan derliyoruz (tamamen ucretsiz, kendi sunucumuzda calisan transkript motoru)
# -DBUILD_SHARED_LIBS=OFF: statik link kullaniyoruz, boylece tek bir self-contained
# binary elde ediyoruz (libwhisper.so / libggml.so'ya calisma zamaninda bagimli kalmiyoruz)
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp \
    && cd /opt/whisper.cpp \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build -j --config Release --target whisper-cli \
    && cp build/bin/whisper-cli /usr/local/bin/whisper-cli

# Multilingual "tiny" modelini indiriyoruz (Turkce destekler, ~75MB, az RAM kullanir)
RUN mkdir -p /opt/whisper-models \
    && curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin \
    -o /opt/whisper-models/ggml-tiny.bin

# Kaynak klasorunu temizleyip yer aciyoruz (sadece binary ve model kaldi)
RUN rm -rf /opt/whisper.cpp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Gecici dosyalar icin klasor
RUN mkdir -p /app/tmp

ENV PORT=8080
ENV WHISPER_MODEL_PATH=/opt/whisper-models/ggml-tiny.bin
EXPOSE 8080

CMD ["node", "server.js"]
