import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";

const execAsync = promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const MAX_VIDEO_SECONDS = 60 * 20; // 20 dakikadan uzun videolari reddet (maliyet/kotuye kullanim koruma)

// ---- Yardimci: gecici dosyalari temizle ----
function cleanup(...filePaths) {
  for (const p of filePaths) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      console.error("Temizlik hatasi:", err.message);
    }
  }
}

// ---- Adim 1: URL'den ses dosyasi indir (yt-dlp) ----
// Not: YouTube destegi kaldirildi - datacenter sunucu IP'leri YouTube tarafindan
// bot olarak isaretleniyor ve bu cookie ile cozulemiyor. TikTok ve Instagram'da
// bu sorun yasanmiyor, bu yuzden sadece bu ikisini destekliyoruz.
async function downloadAudio(videoUrl, jobId) {
  const outputTemplate = path.join(TMP_DIR, `${jobId}.%(ext)s`);
  const finalPath = path.join(TMP_DIR, `${jobId}.mp3`);

  // Once video suresini kontrol et (asiri uzun videolari engellemek icin)
  const { stdout: durationOut } = await execAsync(
    `yt-dlp --no-warnings --print "%(duration)s" "${videoUrl}"`,
    { timeout: 30000 }
  );
  const duration = parseFloat(durationOut.trim());
  if (!isNaN(duration) && duration > MAX_VIDEO_SECONDS) {
    throw new Error(
      `Video cok uzun (${Math.round(duration / 60)} dk). En fazla ${MAX_VIDEO_SECONDS / 60} dk desteklenir.`
    );
  }

  // Sesi indir ve mp3'e cevir
  await execAsync(
    `yt-dlp --no-warnings -x --audio-format mp3 --audio-quality 5 -o "${outputTemplate}" "${videoUrl}"`,
    { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }
  );

  if (!fs.existsSync(finalPath)) {
    throw new Error("Ses dosyasi indirilemedi. Video linki gecersiz veya platform desteklenmiyor olabilir.");
  }

  return finalPath;
}

// ---- Adim 2: Ses dosyasini OpenRouter STT API ile yaziya cevir ----
// Tek bir OpenRouter key'i ile hem transcript hem tarif cikarma yapiliyor,
// kullaniciya ayrica OpenAI key'i sormamiza gerek kalmiyor.
async function transcribeAudio(audioPath, apiKey, sttModel) {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBase64 = audioBuffer.toString("base64");

  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: sttModel || "openai/whisper-large-v3-turbo",
      input_audio: {
        data: audioBase64,
        format: "mp3",
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Transcript cikarma hatasi (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.text || "";
}

// ---- Adim 3: Transcript'ten LLM ile Turkce tarif cikar (OpenRouter) ----
async function extractRecipe(transcript, apiKey, model) {
  const systemPrompt = `Sen bir yemek tarifi cikarma asistanisin. Sana bir video transkripti verilecek.
Bu transkriptten yemek tarifini TÜRKÇE olarak, asagidaki JSON formatinda cikar.
Sadece JSON dondur, baska aciklama ekleme, markdown kod bloğu kullanma.

Format:
{
  "baslik": "Yemegin adi",
  "porsiyon": "Kac kisilik (varsa, yoksa tahmin et)",
  "malzemeler": ["malzeme 1 - miktar", "malzeme 2 - miktar"],
  "adimlar": ["1. adim aciklamasi", "2. adim aciklamasi"],
  "notlar": "Varsa ek ipuclari, yoksa bos string"
}

Eger transkriptte tarif bilgisi yoksa veya yetersizse, "baslik" alanina "TARIF BULUNAMADI" yaz ve nedenini "notlar" alanina ekle.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "anthropic/claude-3.5-sonnet",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Video transkripti:\n\n${transcript}` },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Tarif cikarma hatasi (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // JSON'u temizle (markdown fence varsa kaldir)
  const cleaned = content.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Model gecersiz bir yanit dondurdu, lutfen tekrar deneyin.");
  }
}

// ---- Ana endpoint ----
app.post("/api/extract-recipe", async (req, res) => {
  const { videoUrl, openrouterKey, model, sttModel } = req.body;

  if (!videoUrl || !openrouterKey) {
    return res.status(400).json({
      error: "videoUrl ve openrouterKey alanlari gerekli.",
    });
  }

  let validUrl;
  try {
    validUrl = new URL(videoUrl);
  } catch {
    return res.status(400).json({ error: "Gecersiz video linki." });
  }

  const allowedHosts = ["tiktok.com", "instagram.com"];
  const isAllowed = allowedHosts.some((h) => validUrl.hostname.includes(h));
  if (!isAllowed) {
    return res.status(400).json({
      error:
        "Sadece TikTok ve Instagram linkleri desteklenir. (YouTube, sunucu altyapimizdaki kisitlamalar nedeniyle suanlik desteklenmiyor.)",
    });
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  let audioPath = null;

  try {
    audioPath = await downloadAudio(videoUrl, jobId);
    const transcript = await transcribeAudio(audioPath, openrouterKey, sttModel);

    if (!transcript || transcript.trim().length < 10) {
      return res.status(422).json({
        error: "Videodan konusma metni cikarilamadi (muzik/sessiz video olabilir).",
      });
    }

    const recipe = await extractRecipe(transcript, openrouterKey, model);
    return res.json({ recipe, transcript });
  } catch (err) {
    // stderr genelde yt-dlp'nin gercek hata mesajini icerir, sadece err.message yetersiz kalabilir
    const detail = err.stderr || err.message || "Bilinmeyen bir hata olustu.";
    console.error("Islem hatasi (detayli):", detail);
    return res.status(500).json({ error: detail.toString().slice(0, 1000) });
  } finally {
    cleanup(audioPath);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "turbo-yemek-backend" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Turbo Yemek backend ${PORT} portunda calisiyor`);
});