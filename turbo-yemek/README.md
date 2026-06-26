# Turbo Yemek 🍳⚡

YouTube, TikTok veya Instagram'daki yemek videosunun linkini yapıştır, tarifi Türkçe ve yazılı olarak çıkar.

## Nasıl çalışır?

1. Kullanıcı video linkini ve kendi API key'lerini girer (key'ler hiçbir zaman sunucuda saklanmaz)
2. Backend (Railway) videoyu indirir, sesini çıkarır
3. Ses, kullanıcının OpenAI key'i ile yazıya çevrilir (Whisper)
4. Yazı, kullanıcının OpenRouter key'i ile bir LLM'e gönderilir, Türkçe tarif olarak çıkarılır
5. Sonuç kullanıcıya gösterilir

**Maliyet modeli:** Sana (uygulama sahibine) sıfıra yakın maliyet — Vercel ve Railway'in ücretsiz/hobi katmanları yeterli. Kullanıcılar kendi API key'leriyle kendi kullanımlarını öderler.

---

## Kurulum

### 1) Backend'i Railway'e deploy et

1. [Railway](https://railway.app)'de hesap aç, GitHub'a bu `backend/` klasörünü içeren bir repo yükle (veya Railway CLI ile deploy et)
2. Railway'de **New Project → Deploy from GitHub repo** seç, repoyu bağla
3. Root directory olarak `backend` klasörünü seç (eğer frontend ve backend aynı repoda ise)
4. Railway, `Dockerfile`'ı otomatik algılayıp build edecek (yt-dlp ve ffmpeg otomatik kurulur)
5. Deploy bitince Railway sana bir URL verecek, örn: `https://turbo-yemek-backend.up.railway.app`
6. Bu URL'yi kopyala — frontend'de kullanacaksın

**Not:** Railway ücretsiz katmanında aylık ~5$ kredi var, küçük/orta kullanım için yeterli.

### 2) Frontend'i Vercel'e deploy et

1. [Vercel](https://vercel.com)'de hesap aç, `frontend/` klasörünü içeren repoyu bağla
2. Proje ayarlarında **Environment Variables** kısmına şunu ekle:
   - `NEXT_PUBLIC_BACKEND_URL` = Railway'den aldığın backend URL'si (örn: `https://turbo-yemek-backend.up.railway.app`)
3. Deploy et — Vercel otomatik olarak Next.js'i tanır, ek ayara gerek yok

### 3) Kullanmaya başla

1. Vercel'in verdiği linke gir
2. Kendi OpenAI API key'ini gir ([buradan alınır](https://platform.openai.com/api-keys))
3. Kendi OpenRouter API key'ini gir ([buradan alınır](https://openrouter.ai/keys))
4. Bir YouTube/TikTok/Instagram yemek videosu linkini yapıştır
5. "Tarifi çıkar" butonuna bas

---

## Yerelde test etme

### Backend
```bash
cd backend
npm install
node server.js
# http://localhost:8080 adresinde çalışır
```

**Not:** Yerelde test için sisteminde `yt-dlp` ve `ffmpeg` kurulu olmalı:
```bash
# Mac
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
pip install yt-dlp
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# http://localhost:3000 adresinde çalışır
```

`frontend/.env.example` dosyasını `.env.local` olarak kopyala, backend yerelde çalışıyorsa değiştirmene gerek yok (varsayılan `http://localhost:8080`).

---

## Önemli notlar ve sınırlamalar

⚠️ **Telif hakkı / Kullanım Şartları riski:** YouTube, TikTok ve Instagram'dan video indirmek, bu platformların kullanım şartlarına aykırı olabilir. Bu proje kişisel/küçük ölçekli kullanım için tasarlanmıştır. Uygulamayı büyük ölçekte yayınlarsan platformlar erişimi engelleyebilir.

⚠️ **Video uzunluk limiti:** Backend, 20 dakikadan uzun videoları işlemeyi reddeder (maliyet ve kötüye kullanım koruması için). `backend/server.js` içindeki `MAX_VIDEO_SECONDS` değerini değiştirerek bunu ayarlayabilirsin.

⚠️ **Gizlilik:** API key'ler sadece kullanıcının tarayıcısında (`localStorage`) saklanır ve sunucuya yalnızca istek sırasında, kaydedilmeden iletilir. Backend hiçbir key'i loglamaz veya diske yazmaz.

⚠️ **Tüm videolar tarif içermez:** Müzik videoları, vlog'lar veya sessiz videolar için sistem "TARİF BULUNAMADI" sonucu döndürür.

---

## Klasör yapısı

```
turbo-yemek/
├── backend/          # Railway'e deploy edilecek
│   ├── server.js      # Ana API mantığı
│   ├── Dockerfile      # yt-dlp + ffmpeg kurulumu
│   ├── package.json
│   └── railway.json
└── frontend/         # Vercel'e deploy edilecek
    ├── pages/
    │   ├── index.js     # Ana sayfa
    │   └── _app.js
    ├── styles/
    │   └── globals.css
    └── package.json
```
