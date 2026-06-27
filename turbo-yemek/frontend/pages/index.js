import { useState, useEffect } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
const MODELS = [
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (ücretsiz, önerilen)" },
  { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek Chat V3 (ücretsiz)" },
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (ücretsiz)" },
];

export default function Home() {
  const [videoUrl, setVideoUrl] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [recipe, setRecipe] = useState(null);

  // Anahtarı sadece tarayıcıda (localStorage) hatırla — sunucuya hiçbir zaman kalıcı kaydedilmez
  useEffect(() => {
    const savedOpenrouter = window.localStorage.getItem("ty_openrouter_key");
    if (savedOpenrouter) setOpenrouterKey(savedOpenrouter);
  }, []);

  useEffect(() => {
    if (openrouterKey) window.localStorage.setItem("ty_openrouter_key", openrouterKey);
  }, [openrouterKey]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setRecipe(null);

    if (!videoUrl || !openrouterKey) {
      setError("Lütfen video linkini ve OpenRouter API anahtarını gir.");
      return;
    }

    setLoading(true);
    setStatusText("Video indiriliyor ve ses çıkarılıyor...");

    try {
      const statusTimer1 = setTimeout(
        () => setStatusText("Ses metne çevriliyor..."),
        4000
      );
      const statusTimer2 = setTimeout(
        () => setStatusText("Tarif çıkarılıyor (Türkçe)..."),
        12000
      );

      const res = await fetch(`${BACKEND_URL}/api/extract-recipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, openrouterKey, model }),
      });

      clearTimeout(statusTimer1);
      clearTimeout(statusTimer2);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Bir şeyler ters gitti.");
      }

      setRecipe(data.recipe);
    } catch (err) {
      setError(err.message || "Bağlantı hatası. Backend adresi doğru mu?");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  return (
    <div className="page">
      <div className="container">
        <header className="hero">
          <div className="speedmark mono">VİDEODAN TARİFE — SANİYELER İÇİNDE</div>
          <h1>
            Turbo<span className="accent"> Yemek</span>
          </h1>
          <p>
            TikTok veya Instagram'daki yemek videosunun linkini yapıştır,
            tarifi Türkçe ve yazılı olarak çıkar.
          </p>
        </header>

        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="videoUrl">Video linki</label>
            <input
              id="videoUrl"
              type="text"
              placeholder="https://www.tiktok.com/@kullanici/video/..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="model">
              Tarif modeli <span className="hint">OpenRouter</span>
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loading}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="openrouterKey">
              OpenRouter API key <span className="hint">tarif çıkarmak için</span>
            </label>
            <input
              id="openrouterKey"
              type="password"
              placeholder="sk-or-..."
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
            <div className="note">
              Ses metne çevirme tamamen kendi sunucumuzda, ücretsiz olarak yapılır. Bu anahtar
              sadece tarifi yazıya dökmek için kullanılır ve sunucuda saklanmaz.{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                Buradan al
              </a>
              .
            </div>
          </div>

          <div className="field" style={{ marginTop: "24px" }}>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Çıkarılıyor..." : "Tarifi çıkar"}
            </button>
          </div>

          {loading && (
            <div className="status">
              <div className="spinner" />
              <span>{statusText}</span>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}
        </form>

        {recipe && <RecipeCard recipe={recipe} />}

        <div className="footer mono">
          Videoları indirmek platformların kullanım şartlarına aykırı olabilir.
          <br />
          Kişisel kullanım amaçlıdır — sorumluluk kullanıcıya aittir.
        </div>
      </div>
    </div>
  );
}

function RecipeCard({ recipe }) {
  const notFound = recipe.baslik === "TARIF BULUNAMADI";

  if (notFound) {
    return (
      <div className="card recipe">
        <div className="recipe-title">Tarif bulunamadı</div>
        <p className="recipe-notes">
          {recipe.notlar || "Bu videoda anlaşılır bir tarif tespit edilemedi."}
        </p>
      </div>
    );
  }

  return (
    <div className="card recipe">
      <div className="recipe-title">{recipe.baslik}</div>
      {recipe.porsiyon && (
        <div className="recipe-meta mono">{recipe.porsiyon}</div>
      )}

      {recipe.malzemeler?.length > 0 && (
        <div className="recipe-section">
          <h3>Malzemeler</h3>
          <ul className="ingredient-list">
            {recipe.malzemeler.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {recipe.adimlar?.length > 0 && (
        <div className="recipe-section">
          <h3>Hazırlanışı</h3>
          <ol className="step-list">
            {recipe.adimlar.map((step, i) => (
              <li key={i}>
                <span className="step-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span>{step.replace(/^\d+[\.\)]\s*/, "")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {recipe.notlar && (
        <div className="recipe-section">
          <h3>Notlar</h3>
          <p className="recipe-notes">{recipe.notlar}</p>
        </div>
      )}
    </div>
  );
}
