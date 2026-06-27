import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import FormData from "form-data";
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

// ---- YouTube cookie dosyasini hazirla (env variable'dan) ----
const COOKIES_PATH = path.join(TMP_DIR, "youtube_cookies.txt");
function ensureCookiesFile() {
  if (process.env.YOUTUBE_COOKIES && !fs.existsSync(COOKIES_PATH)) {
    fs.writeFileSync(COOKIES_PATH, process.env.YOUTUBE_COOKIES, "utf-8");
  }
  return fs.existsSync(COOKIES_PATH) ? COOKIES_PATH : null;
}

// ---- Adim 1: URL'den ses dosyasi indir (yt-dlp) ----
async function downloadAudio(videoUrl, jobId) {
  const outputTemplate = path.join(TMP_DIR, `${jobId}.%(ext)s`);
  const finalPath = path.join(TMP_DIR, `${jobId}.mp3`);

  // YouTube bot tespitini atlatmak icin: once cookie dosyasi varsa onu kullan,
  // yoksa android client spoofing'e geri don
  const cookiesFile = ensureCookiesFile();
  const authArgs = cookiesFile
    ? `--cookies "${cookiesFile}"`
    : `--extractor-args "youtube:player_client=android"`;

  // Once video suresini kontrol et (asiri uzun/buyuk videolari engellemek icin)
  const { stdout: durationOut } = await execAsync(
    `yt-dlp --no-warnings ${authArgs} --print "%(duration)s" "${videoUrl}"`,
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
    `yt-dlp --no-warnings ${authArgs} -x --audio-format mp3 --audio-quality 5 -o "${outputTemplate}" "${videoUrl}"`,
    { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }
  );

  if (!fs.existsSync(finalPath)) {
    throw new Error("Ses dosyasi indirilemedi. Video linki gecersiz veya platform desteklenmiyor olabilir.");
  }

  return finalPath;
}

// ---- Adim 2: Ses dosyasini OpenAI Whisper API ile yaziya cevir ----
async function transcribeAudio(audioPath, apiKey) {
  const form = new FormData();
  form.append("file", fs.createReadStream(audioPath));
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Transcript cikarma hatasi (${response.status}): ${errText.slice(0, 300)}`);
  }

  return await response.text();
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
  const { videoUrl, openaiKey, openrouterKey, model } = req.body;

  if (!videoUrl || !openaiKey || !openrouterKey) {
    return res.status(400).json({
      error: "videoUrl, openaiKey ve openrouterKey alanlari gerekli.",
    });
  }

  let validUrl;
  try {
    validUrl = new URL(videoUrl);
  } catch {
    return res.status(400).json({ error: "Gecersiz video linki." });
  }

  const allowedHosts = ["youtube.com", "youtu.be", "tiktok.com", "instagram.com"];
  const isAllowed = allowedHosts.some((h) => validUrl.hostname.includes(h));
  if (!isAllowed) {
    return res.status(400).json({
      error: "Sadece YouTube, TikTok ve Instagram linkleri desteklenir.",
    });
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  let audioPath = null;

  try {
    audioPath = await downloadAudio(videoUrl, jobId);
    const transcript = await transcribeAudio(audioPath, openaiKey);

    if (!transcript || transcript.trim().length < 10) {
      return res.status(422).json({
        error: "Videodan konusma metni cikarilamadi (muzik/sessiz video olabilir).",
      });
    }

    const recipe = await extractRecipe(transcript, openrouterKey, model);
    return res.json({ recipe, transcript });
  } catch (err) {
    console.error("Islem hatasi:", err.message);
    return res.status(500).json({ error: err.message || "Bilinmeyen bir hata olustu." });
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
