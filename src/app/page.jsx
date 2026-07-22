"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import "./globals.css";

/* ═══════════════════════════════════════════════════════════════════════
   ATELIER — Standalone Web App
   All Pixa calls go through /api/pixa/* (API key is server-side only).
   File upload goes through /api/upload (native browser FormData).
   Copy generation goes through /api/copy.
═══════════════════════════════════════════════════════════════════════ */

/* ── API helpers ─────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `API error ${res.status}`);
  return data;
}

async function pollJob(jobId, onProgress) {
  for (let i = 0; i < 150; i++) {  // 150 × 3 s = 7.5 min max
    const data = await api(`/api/pixa/status?job_id=${jobId}`).catch(() => null);
    if (data?.status === "completed") return data;
    if (data?.status === "failed" || data?.status === "canceled") throw new Error(data.error || "Generation failed");
    if (onProgress && data?.progress != null) onProgress(data.progress, data.state);
    await sleep(3000);
  }
  throw new Error("Timed out — the image is taking unusually long. Please try again.");
}

async function getAsset(assetId) {
  for (let i = 0; i < 60; i++) {  // 60 × 3 s = 3 min max
    const a = await api(`/api/pixa/assets?action=get&asset_id=${assetId}`).catch(() => null);
    if (a?.status === "ready") return a;
    if (a?.status === "failed") throw new Error(a.error_message || "Generation failed");
    await sleep(3000);
  }
  throw new Error("Asset not ready yet — please try again.");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Persistence ────────────────────────────────────────────────────── */
function ls(key, fb) {
  if (typeof window === "undefined") return fb;
  try { return JSON.parse(localStorage.getItem(key)) ?? fb; } catch { return fb; }
}
function lsSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

/* ── Prompt builders ────────────────────────────────────────────────── */
const NAMES = {
  Female: ["Amara","Sofia","Yuna","Priya","Leila","Ingrid","Zara","Camille","Naomi","Elena"],
  Male:   ["Kofi","Mateo","Kenji","Arjun","Omar","Lars","Dante","Julian","Marcus","Theo"],
  "Non-binary": ["River","Sage","Noor","Kai","Ari","Rowan","Ren","Alix","Micah","Sol"],
};
function pickName(gender, usedNames) {
  const pool = NAMES[gender] || NAMES["Non-binary"];
  const free = pool.filter(n => !usedNames.has(n));
  return (free.length ? free : pool)[Math.floor(Math.random() * (free.length || pool.length))];
}

function avatarPrompt(p) {
  const gw    = { Female: "woman", Male: "man", "Non-binary": "person" }[p.gender];
  const hair  = p.hair.startsWith("Natural") ? "naturally textured hair" : `${p.hair.toLowerCase()} hair`;
  const eyes  = p.eyes.startsWith("Natural") ? "" : `${p.eyes.toLowerCase()} eyes, `;
  const detail = p.detail ? `${p.detail}. ` : "";

  // Explicit pose description — locks exactly 2 arms, 2 hands, no extras
  const pose = p.gender === "Male"
    ? "standing in a relaxed confident pose, right arm hanging naturally at side, left hand resting loosely on left hip — exactly two arms and two hands, no more"
    : "standing in a natural elegant pose, right arm relaxed at side, left hand resting gently on left hip — exactly two arms and two hands, nothing else";

  return (
    // Camera & technical setup first — grounds the model in photography space
    `RAW PHOTOGRAPH taken on Hasselblad H6D-100c, 100MP medium-format sensor, 80mm f/2.8 lens at f/2.8, ` +
    `ISO 64, 1/160s, perfectly exposed. ` +
    `Subject is a real ${gw}, aged ${p.age}, ${p.ethnicity} heritage, ${p.body.toLowerCase()} build, ${hair}. ` +
    `${eyes}${detail}` +

    // Anatomy lock — most important section
    `ANATOMY: ${pose}. ` +
    `The body has exactly one head, one neck, two shoulders, two upper arms, two forearms, two hands with five fingers each. ` +
    `No floating limbs, no extra hands, no phantom arms — every limb is clearly attached to the torso. ` +
    `Framing: waist-up portrait, torso and both arms fully visible within frame. ` +

    // Skin — ultra-realism
    `SKIN: genuine photographic skin texture — open pores visible at 100% crop, fine vellus hair across cheeks and forehead, ` +
    `natural sebaceous sheen, realistic subsurface light scatter giving warm depth under skin surface, ` +
    `micro-imperfections and natural tone variation across nose, cheeks and chin. ` +
    `Zero digital smoothing, zero beauty-filter processing, zero airbrushing. ` +
    `Skin must pass as a real person at full resolution. ` +

    // Eyes
    `EYES: fibrous iris texture with visible depth and limbal ring, corneal specular highlight from key light, ` +
    `natural sclera with faint vessels at inner corners, individually rendered lashes. Emotionally present gaze. ` +

    // Lips
    `LIPS: fine surface lip texture, authentic pigmentation variation, subtle cupid's-bow highlight, ` +
    `faint natural lip lines — no gloss, no filter, no CGI render. ` +

    // Lighting & background
    `Lighting: large 120cm octabox key light at 45° camera-left, silver reflector fill at camera-right, ` +
    `hairlight separation rim from behind. Neutral warm-grey seamless backdrop. ` +
    `Colour grade: natural daylight balance, no heavy LUT. ` +

    // Final quality bar
    `Final image must be completely and utterly indistinguishable from a real editorial photograph. ` +
    `Casting-card standard for Chanel, Dior, or Valentino. No AI tells whatsoever.`
  );
}

const SHOTS = {
  hero:   { label: "Hero · Billboard",  ar: "16:9", ratioClass: "hero-ratio" },
  social: { label: "Social · Feed",     ar: "1:1",  ratioClass: "sq-ratio"   },
  story:  { label: "Story · Vertical",  ar: "9:16", ratioClass: "vert-ratio" },
};

function shotPrompt(kind, copy, brief, avatar) {
  const hasProd = brief.productRef;
  const prodLine = hasProd
    ? " The product shown in the second reference image must appear exactly as-is — identical packaging, label, typography and colors, no redesign."
    : "";
  const base =
    `Professional advertising photograph for the brand campaign of "${brief.product}" (${brief.desc || "premium product"}).${prodLine} ` +
    `Feature the exact same person as in the first reference image — identical face, hair, skin tone and body structure (${avatar.profile.body} build) — as the campaign model. ` +
    `Scene: ${copy.scenes[kind]}. Art direction: ${brief.tone} brand aesthetic. ` +
    `Hyper-photorealistic commercial photography, natural believable skin texture, flawless product rendering, ` +
    `high-end agency retouching, shot on medium-format camera, magazine-grade lighting.`;
  if (kind === "hero") {
    return base + ` Elegantly typeset the headline "${copy.headline}" into the negative space of the composition, and the tagline "${copy.tagline}" in smaller type beneath it.`;
  }
  return base + " No text or typography in the image.";
}

/* ═══════════════════════════════════════════════════════════════════════
   DEFAULT PRICING PLANS
═══════════════════════════════════════════════════════════════════════ */
const DEFAULT_PLANS = [
  { name: "Free Trial", price: "$0",   per: "one-off",  features: "1 model · 5 campaign packs · social formats · Pixa credits not included", link: "", featured: false },
  { name: "Starter",    price: "$29",  per: "/month",   features: "3 models · 5 campaign packs · social formats · Pixa credits not included", link: "", featured: false },
  { name: "Studio",     price: "$99",  per: "/month",   features: "15 models · 30 campaign packs · full packs with copywriting · priority renders", link: "", featured: true },
  { name: "Agency",     price: "$299", per: "/month",   features: "Unlimited models & campaigns · white-label boards · multi-brand workspaces · dedicated support", link: "", featured: false },
];

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function AtelierApp() {
  /* ── Tabs ── */
  const [tab, setTab] = useState("casting");

  /* ── Roster / casting ── */
  const [avatars, setAvatarsRaw]     = useState([]);
  const [selectedId, setSelectedId]  = useState(null);
  const [castStatus, setCastStatus]  = useState(null); // { kind: "info"|"err", html }
  const [casting, setCasting]        = useState(false);

  /* Casting form */
  const [gender,    setGender]    = useState("Female");
  const [age,       setAge]       = useState("25–34");
  const [ethnicity, setEthnicity] = useState("White / European descent");
  const [body,      setBody]      = useState("Athletic");
  const [hair,      setHair]      = useState("Natural — stylist's choice");
  const [eyes,      setEyes]      = useState("Natural — director's choice");
  const [detail,    setDetail]    = useState("");
  const [engine,    setEngine]    = useState("nano-banana-2");

  /* ── Campaigns ── */
  const [campaigns, setCampaignsRaw] = useState([]);
  const [campStatus, setCampStatus]  = useState(null);
  const [producing, setProducing]    = useState(false);

  /* Campaign form */
  const [cAvatarId, setCAvatarId] = useState("");
  const [cProduct,  setCProduct]  = useState("");
  const [cDesc,     setCDesc]     = useState("");
  const [cTone,     setCTone]     = useState("Luxury / premium");
  const [cSetting,  setCSetting]  = useState("Art director's choice");
  const [cPack,     setCPack]     = useState("full");
  const [productRef, setProductRef] = useState(null);
  const [libOpen, setLibOpen]       = useState(false);
  const [libItems, setLibItems]     = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [allowNoProduct, setAllowNoProduct] = useState(false);
  const prodFileRef = useRef(null);

  /* ── Pricing ── */
  const [plans, setPlansRaw]     = useState(DEFAULT_PLANS);
  const [planSetupOpen, setPlanSetupOpen] = useState(false);

  /* ── Init from localStorage ── */
  useEffect(() => {
    setAvatarsRaw(ls("atelier_avatars", []));
    setCampaignsRaw(ls("atelier_campaigns", []));
    setPlansRaw(ls("atelier_plans", DEFAULT_PLANS));
  }, []);

  /* Sync avatar select default */
  useEffect(() => {
    if (avatars.length && !cAvatarId) setCAvatarId(avatars[0].id);
  }, [avatars]);

  /* ── Persisted setters ── */
  const setAvatars = useCallback(fn => {
    setAvatarsRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      lsSet("atelier_avatars", next);
      return next;
    });
  }, []);
  const setCampaigns = useCallback(fn => {
    setCampaignsRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      lsSet("atelier_campaigns", next);
      return next;
    });
  }, []);
  const setPlans = useCallback(fn => {
    setPlansRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      lsSet("atelier_plans", next);
      return next;
    });
  }, []);

  const selectedAvatar = avatars.find(a => a.id === selectedId) || avatars[0] || null;

  /* ═══════════════════════════════════════════════════════════════════
     CASTING
  ═══════════════════════════════════════════════════════════════════ */
  async function castModel() {
    setCasting(true);
    setCastStatus({ kind: "info", html: '<span class="spinner"></span>In the studio — lighting, lens, first frames… (20–40 s)' });
    try {
      const profile = { gender, age, ethnicity, body, hair, eyes, detail };
      const castPrompt = avatarPrompt(profile);

      const gen = await api("/api/pixa/generate", {
        method: "POST",
        body: JSON.stringify({ model: engine, prompt: castPrompt, shot_kind: "avatar", aspect_ratio: "3:4", resolution: "2K", num_variations: 1, media_type: "image", output_format: "png" }),
      });

      setCastStatus({ kind: "info", html: '<span class="spinner"></span>Rendering… 0%' });
      await pollJob(gen.job_id, (pct, state) => {
        const label = state === "queuing" ? "In queue" : state === "generating" ? "Rendering" : "Processing";
        setCastStatus({ kind: "info", html: `<span class="spinner"></span>${label}… ${pct > 0 ? pct + "%" : ""}` });
      });
      const asset = await getAsset(gen.asset_ids[0]);

      const usedNames = new Set(avatars.map(a => a.name.split(" ")[0]));
      const avatar = {
        id: asset.id,
        name: pickName(gender, usedNames),
        profile,
        engine,
        url: asset.url,
        thumb: asset.thumbnail_url || asset.url,
        created: Date.now(),
      };
      setAvatars(prev => [avatar, ...prev]);
      setSelectedId(avatar.id);
      setCastStatus(null);
    } catch (e) {
      setCastStatus({ kind: "err", html: `Casting failed: ${e.message}` });
    }
    setCasting(false);
  }

  /* ═══════════════════════════════════════════════════════════════════
     PRODUCT IMAGE UPLOAD
  ═══════════════════════════════════════════════════════════════════ */
  async function uploadProductFile(file) {
    if (!file) return;
    setCampStatus({ kind: "info", html: `<span class="spinner"></span>Uploading ${file.name}…` });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setProductRef({ asset_id: data.asset_id, name: file.name, thumb: URL.createObjectURL(file) });
      setCampStatus(null);
    } catch (e) {
      setCampStatus({ kind: "err", html: `Upload failed: ${e.message}` });
    }
  }

  /* Library */
  async function openLibrary() {
    setLibOpen(v => !v);
    if (libOpen) return;
    setLibLoading(true);
    try {
      const res = await api("/api/pixa/assets?action=list&limit=50&status=ready");
      const imgs = (res.items || []).filter(a => a.media_type === "image");
      const uploads = imgs.filter(a => a.source === "upload");
      const gens    = imgs.filter(a => a.source !== "upload");
      setLibItems([...uploads, ...gens]);
    } catch (e) {
      setCampStatus({ kind: "err", html: `Could not load library: ${e.message}` });
    }
    setLibLoading(false);
  }

  function pickLibraryItem(item) {
    setProductRef({ asset_id: item.id, thumb: item.thumbnail_url || item.url, name: item.name || "Library image" });
    setLibOpen(false);
  }

  /* ═══════════════════════════════════════════════════════════════════
     CAMPAIGN
  ═══════════════════════════════════════════════════════════════════ */
  async function runCampaign() {
    const avatar = avatars.find(a => a.id === cAvatarId);
    if (!avatar) { setCampStatus({ kind: "err", html: "Pick a model from your roster first." }); return; }
    if (!cProduct.trim()) { setCampStatus({ kind: "err", html: "Give the product a name." }); return; }
    if (!productRef && !allowNoProduct) {
      setAllowNoProduct(true);
      setCampStatus({ kind: "err", html: "⚠️ No product image attached — the engine will <b>invent</b> the packaging. Upload your real product above, or click <b>Produce campaign</b> again to continue without it." });
      return;
    }
    setAllowNoProduct(false);
    setProducing(true);

    const brief = { product: cProduct.trim(), desc: cDesc.trim(), tone: cTone, setting: cSetting, productRef };
    const kinds = cPack === "full" ? ["hero", "social", "story"] : ["hero"];

    try {
      setCampStatus({ kind: "info", html: '<span class="spinner"></span>Creative direction — writing the concept & copy…' });
      const copy = await api("/api/copy", { method: "POST", body: JSON.stringify({ product: brief.product, desc: brief.desc, tone: brief.tone, setting: brief.setting }) });

      const campaign = {
        id: `camp_${Date.now()}`,
        product: brief.product,
        avatarName: avatar.name,
        avatarId: avatar.id,
        productRef,
        tone: brief.tone,
        copy,
        created: Date.now(),
        shots: kinds.map(k => ({ kind: k, status: "pending", assetId: null, url: null, ar: SHOTS[k].ar, prompt: shotPrompt(k, copy, brief, avatar) })),
      };
      setCampaigns(prev => [campaign, ...prev]);

      setCampStatus({ kind: "info", html: `<span class="spinner"></span>On set — producing ${kinds.length} shot${kinds.length > 1 ? "s" : ""} with ${avatar.name}… (~1 min per shot)` });

      await Promise.all(
        campaign.shots.map((s, i) =>
          sleep(i * 1500).then(() => produceShot(campaign.id, s, avatar, brief))
        )
      );

      setCampaigns(prev => {
        const c = prev.find(x => x.id === campaign.id);
        const failed = c?.shots.filter(s => s.status === "failed") || [];
        if (failed.length) setCampStatus({ kind: "err", html: `${failed.length} shot(s) failed — click Retry on the board.` });
        else setCampStatus(null);
        return prev;
      });
    } catch (e) {
      setCampStatus({ kind: "err", html: `Production failed: ${e.message}` });
    }
    setProducing(false);
  }

  async function produceShot(campaignId, shot, avatar, brief) {
    updateShot(campaignId, shot.kind, { status: "rendering" });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const atts = [{ key: "image_0", url: avatar.url }];
        if (brief.productRef?.asset_id) atts.push({ key: "image_1", url: brief.productRef.asset_id }); // asset_id is now a CDN URL

        const gen = await api("/api/pixa/generate", {
          method: "POST",
          body: JSON.stringify({ model: "nano-banana-2", prompt: shot.prompt, shot_kind: shot.kind, aspect_ratio: shot.ar, media_type: "image", output_format: "png", num_variations: 1, attachments: atts }),
        });
        await pollJob(gen.job_id);
        const asset = await getAsset(gen.asset_ids[0]);
        updateShot(campaignId, shot.kind, { status: "done", assetId: asset.id, url: asset.url, error: null });
        return;
      } catch (e) {
        if (attempt === 1) updateShot(campaignId, shot.kind, { status: "failed", error: e.message });
        else await sleep(3000);
      }
    }
  }

  function updateShot(campaignId, kind, patch) {
    setCampaigns(prev => {
      const next = prev.map(c => {
        if (c.id !== campaignId) return c;
        return { ...c, shots: c.shots.map(s => s.kind === kind ? { ...s, ...patch } : s) };
      });
      return next;
    });
  }

  async function retryShot(campaignId, kind) {
    const c = campaigns.find(x => x.id === campaignId);
    const s = c?.shots.find(x => x.kind === kind);
    if (!c || !s) return;
    const avatar = avatars.find(a => a.id === c.avatarId);
    if (!avatar) { setCampStatus({ kind: "err", html: "Original talent no longer in roster." }); return; }
    setCampStatus({ kind: "info", html: `<span class="spinner"></span>Re-shooting ${SHOTS[kind].label.toLowerCase()}…` });
    await produceShot(campaignId, s, avatar, { product: c.product, desc: "", tone: c.tone, setting: "", productRef: c.productRef });
    setCampStatus(null);
  }

  async function downloadAsset(urlOrId, filename = "atelier-image.png") {
    // Resolve URL — if it's already a URL use it directly, otherwise fetch via assets route
    let url = urlOrId;
    if (urlOrId && !urlOrId.startsWith("http")) {
      try {
        const data = await api("/api/pixa/assets", { method: "POST", body: JSON.stringify({ asset_id: urlOrId }) });
        url = data.url || data.download_url;
      } catch {}
    }
    if (!url) { alert("Image not available yet."); return; }
    try {
      // Fetch as blob so browser triggers Save As instead of navigating
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      // CORS fallback — open in new tab so user can right-click → save
      window.open(url, "_blank");
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════ */
  const creditMap = {
    "imagen4-ultra":  18,
    "imagen4":        12,
    "imagen4-fast":    6,
    "nano-banana-2":   8,
  };

  return (
    <>
      {/* ── Header ── */}
      <header>
        <div className="brand">
          <h1>ATELIER<span>.</span></h1>
          <p>AI Casting &amp; Campaign Studio</p>
        </div>
        <div className="header-meta">
          Every model is synthetic. Every campaign is yours.
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav>
        {["casting", "campaign", "pricing"].map((t, i) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {String(i + 1).padStart(2, "0")} · {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>

        {/* ══════════════════ CASTING TAB ══════════════════ */}
        {tab === "casting" && (
          <section>
            <div className="section-title">Cast your model</div>
            <div className="section-sub">Compose a photoreal talent profile. Studio-grade renders, saved to your roster for campaigns.</div>

            <div className="cols">
              {/* ── Form ── */}
              <div className="card">
                <h3>Talent Profile</h3>
                <div className="field-row">
                  <div className="field">
                    <label>Gender</label>
                    <select value={gender} onChange={e => setGender(e.target.value)}>
                      <option>Female</option><option>Male</option><option>Non-binary</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Age</label>
                    <select value={age} onChange={e => setAge(e.target.value)}>
                      <option>18–24</option><option>25–34</option><option>35–44</option>
                      <option>45–54</option><option>55–64</option><option>65+</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>Ethnicity</label>
                  <select value={ethnicity} onChange={e => setEthnicity(e.target.value)}>
                    <option>Black / African descent</option>
                    <option>East Asian</option><option>South Asian</option>
                    <option>Southeast Asian</option><option>Hispanic / Latino</option>
                    <option>Middle Eastern / North African</option>
                    <option>White / European descent</option>
                    <option>Mixed heritage</option>
                    <option>Indigenous / Native</option><option>Pacific Islander</option>
                  </select>
                </div>
                <div className="field">
                  <label>Body structure</label>
                  <select value={body} onChange={e => setBody(e.target.value)}>
                    <option>Slim</option><option>Athletic</option><option>Average</option>
                    <option>Curvy</option><option>Muscular</option><option>Plus-size</option>
                    <option>Tall &amp; lean</option><option>Petite</option>
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Hair</label>
                    <select value={hair} onChange={e => setHair(e.target.value)}>
                      <option>Natural — stylist's choice</option>
                      <option>Short dark</option><option>Long dark</option>
                      <option>Short blonde</option><option>Long blonde</option>
                      <option>Auburn / red</option><option>Curly natural</option>
                      <option>Braids</option><option>Silver / grey</option>
                      <option>Shaved / buzzed</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Eyes</label>
                    <select value={eyes} onChange={e => setEyes(e.target.value)}>
                      <option>Natural — director's choice</option>
                      <option>Brown</option><option>Dark brown</option><option>Hazel</option>
                      <option>Green</option><option>Blue</option><option>Grey</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>Signature detail <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                  <input type="text" value={detail} onChange={e => setDetail(e.target.value)} placeholder="e.g. freckles, dimples, strong jawline" />
                </div>
                <div className="field">
                  <label>Render engine</label>
                  <select value={engine} onChange={e => setEngine(e.target.value)}>
                    <option value="nano-banana-2">Nano Banana 2 — fast &amp; reliable, 2K (8 cr) ★ Recommended</option>
                    <option value="imagen4-fast">Imagen 4 Fast — balanced speed, 2K (6 cr)</option>
                    <option value="imagen4">Imagen 4 — higher quality, 2K (12 cr)</option>
                    <option value="imagen4-ultra">Imagen 4 Ultra — premium quality, 2K (18 cr) — slower</option>
                  </select>
                </div>
                <button className="btn" onClick={castModel} disabled={casting}>
                  {casting ? <><span className="spinner" />Casting…</> : "Cast this model"}
                </button>
                <div className="credit-note">Uses ~{creditMap[engine]} kie.ai credits per cast</div>
                <StatusBox status={castStatus} />
              </div>

              {/* ── Stage + Roster ── */}
              <div>
                <div className="stage">
                  {selectedAvatar ? (
                    <AvatarHero
                      avatar={selectedAvatar}
                      onCampaign={() => { setTab("campaign"); setCAvatarId(selectedAvatar.id); }}
                      onDownload={() => downloadAsset(selectedAvatar.url, `${selectedAvatar.name}.png`)}
                    />
                  ) : (
                    <div className="stage-empty">
                      <div className="mark">✦</div>
                      <div style={{ fontFamily: "var(--serif)", fontSize: 18, marginBottom: 6 }}>The stage is yours</div>
                      Define the profile on the left and cast your first model. Renders take about 20–40 seconds.
                    </div>
                  )}
                </div>
                <div className="roster">
                  <div className="divider-label">Roster</div>
                  {avatars.length === 0 ? (
                    <div className="empty-note">No talent yet — cast your first model above.</div>
                  ) : (
                    <div className="roster-grid">
                      {avatars.map(a => (
                        <div key={a.id} className={`roster-card${a.id === (selectedAvatar?.id) ? " selected" : ""}`} onClick={() => setSelectedId(a.id)}>
                          <button className="rc-del" onClick={e => { e.stopPropagation(); setAvatars(prev => prev.filter(x => x.id !== a.id)); }}>remove</button>
                          <img src={a.thumb || a.url} alt={a.name} onError={e => { e.target.src = ""; }} />
                          <div className="rc-name">{a.name}</div>
                          <div className="rc-sub">{a.profile.age} · {(a.profile.ethnicity || "").split("/")[0].trim()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════ CAMPAIGN TAB ══════════════════ */}
        {tab === "campaign" && (
          <section>
            <div className="section-title">Build a campaign</div>
            <div className="section-sub">Pick a face from your roster, describe the product, and Atelier art-directs a full campaign pack with consistent talent across every shot.</div>

            <div className="cols">
              <div className="card">
                <h3>Brief</h3>
                <div className="field">
                  <label>Talent</label>
                  <select value={cAvatarId} onChange={e => setCAvatarId(e.target.value)}>
                    {avatars.length === 0 ? <option value="">— cast a model first —</option>
                      : avatars.map(a => <option key={a.id} value={a.id}>{a.name} — {a.profile.gender}, {a.profile.age}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Product name</label>
                  <input type="text" value={cProduct} onChange={e => setCProduct(e.target.value)} placeholder="e.g. Aurea — vitamin C serum" />
                </div>
                <div className="field">
                  <label>Product description</label>
                  <textarea value={cDesc} onChange={e => setCDesc(e.target.value)} placeholder="What is it, who is it for, what makes it special?" />
                </div>

                {/* Product image — native upload */}
                <div className="field">
                  <label>Product image <span style={{ textTransform: "none", letterSpacing: 0 }}>(keeps packaging exact)</span></label>

                  {productRef ? (
                    <div className="prod-chip">
                      {productRef.thumb && <img src={productRef.thumb} alt="" onError={e => { e.target.style.display = "none"; }} />}
                      <span>✓ {productRef.name || "Product image attached"}</span>
                      <button onClick={() => setProductRef(null)}>remove</button>
                    </div>
                  ) : (
                    <DropZone onFile={uploadProductFile} />
                  )}
                </div>

                <div className="field-row">
                  <div className="field">
                    <label>Brand tone</label>
                    <select value={cTone} onChange={e => setCTone(e.target.value)}>
                      <option>Luxury / premium</option><option>Minimalist / clean</option>
                      <option>Bold / high-energy</option><option>Warm / natural</option>
                      <option>Tech / futuristic</option><option>Playful / youthful</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Setting</label>
                    <select value={cSetting} onChange={e => setCSetting(e.target.value)}>
                      <option>Art director's choice</option><option>Studio seamless</option>
                      <option>Urban / city</option><option>Nature / outdoors</option>
                      <option>Home / interior</option><option>Nightlife / evening</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>Pack</label>
                  <select value={cPack} onChange={e => setCPack(e.target.value)}>
                    <option value="full">Full pack — hero 16:9 + social 1:1 + story 9:16 (90 cr)</option>
                    <option value="hero">Hero only — 16:9 (30 cr)</option>
                  </select>
                </div>
                <button className="btn" onClick={runCampaign} disabled={producing}>
                  {producing ? <><span className="spinner" />On set…</> : "Produce campaign"}
                </button>
                <div className="credit-note">Copywriting included — headline &amp; tagline generated with the shots</div>
                <StatusBox status={campStatus} />
              </div>

              <div>
                {campaigns.length === 0 ? (
                  <div className="empty-note">Campaigns you produce will appear here as art-directed boards.</div>
                ) : (
                  campaigns.map(c => (
                    <CampaignBoard
                      key={c.id}
                      campaign={c}
                      avatar={avatars.find(a => a.id === c.avatarId) || null}
                      onRetry={retryShot}
                      onDownload={downloadAsset}
                      onDelete={id => setCampaigns(prev => prev.filter(x => x.id !== id))}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════ PRICING TAB ══════════════════ */}
        {tab === "pricing" && (
          <section>
            <div className="section-title">Pricing</div>
            <div className="section-sub">Offer ATELIER as a service. Paste your Stripe Payment Links below — customers check out on Stripe's secure hosted page.</div>

            <div className="plans">
              {plans.map(p => (
                <div key={p.name} className={`plan${p.featured ? " featured" : ""}`}>
                  {p.featured && <span className="badge">Most popular</span>}
                  <h4>{p.name}</h4>
                  <div className="price">{p.price}<small>{p.per}</small></div>
                  <div className="feats" dangerouslySetInnerHTML={{ __html: p.features }} />
                  {isStripeLink(p.link)
                    ? <a className="btn accent" href={p.link} target="_blank" rel="noopener">{p.price === "$0" ? "Start free trial" : "Subscribe via Stripe"}</a>
                    : <button className="btn" disabled title="Paste a Stripe link to activate">Connect Stripe to activate</button>
                  }
                </div>
              ))}
            </div>

            <button className="btn ghost small" style={{ marginTop: 20 }} onClick={() => setPlanSetupOpen(v => !v)}>
              {planSetupOpen ? "Close plan setup" : "Configure plans & Stripe links"}
            </button>

            {planSetupOpen && (
              <div className="card" style={{ marginTop: 14 }}>
                <h3>Plan configuration</h3>
                {plans.map((p, i) => (
                  <div key={i}>
                    <div className="field-row" style={{ marginBottom: 4 }}>
                      <div className="field">
                        <label>Plan {i + 1} name</label>
                        <input type="text" value={p.name} onChange={e => setPlans(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      </div>
                      <div className="field">
                        <label>Price</label>
                        <input type="text" value={p.price} onChange={e => setPlans(prev => prev.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                      </div>
                    </div>
                    <div className="field">
                      <label>Stripe Payment Link</label>
                      <input
                        type="text"
                        placeholder="https://buy.stripe.com/…"
                        value={p.link}
                        onChange={e => {
                          const v = e.target.value.trim();
                          if (v && !isStripeLink(v)) { alert("That doesn't look like a Stripe Payment Link (should start with https://buy.stripe.com/)"); return; }
                          setPlans(prev => prev.map((x, j) => j === i ? { ...x, link: v } : x));
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                  Only Stripe-hosted links (buy.stripe.com / checkout.stripe.com) are accepted so buyers always land on Stripe's secure checkout.
                </div>
              </div>
            )}

            <div className="section-sub" style={{ marginTop: 16 }}>
              To activate checkout: in your Stripe Dashboard create a product per plan → generate a <b>Payment Link</b> → paste the URL above. Saved automatically.
            </div>
          </section>
        )}

      </main>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
═══════════════════════════════════════════════════════════════════════ */
function StatusBox({ status }) {
  if (!status) return null;
  return (
    <div
      className={`status show ${status.kind}`}
      dangerouslySetInnerHTML={{ __html: status.html }}
    />
  );
}

function AvatarHero({ avatar, onCampaign, onDownload }) {
  const p = avatar.profile;
  return (
    <div className="avatar-hero">
      <img src={avatar.url} alt={avatar.name} onError={e => { e.target.alt = "Preview unavailable"; }} />
      <div className="avatar-meta">
        <h2>{avatar.name}</h2>
        <div className="tagline">Atelier exclusive talent</div>
        <dl className="spec">
          <dt>Gender</dt><dd>{p.gender}</dd>
          <dt>Age</dt><dd>{p.age}</dd>
          <dt>Ethnicity</dt><dd>{p.ethnicity}</dd>
          <dt>Body</dt><dd>{p.body}</dd>
          <dt>Hair</dt><dd>{p.hair}</dd>
          <dt>Eyes</dt><dd>{p.eyes}</dd>
          {p.detail && <><dt>Signature</dt><dd>{p.detail}</dd></>}
        </dl>
        <div className="avatar-actions">
          <button className="btn small" onClick={onCampaign}>Book for campaign</button>
          <button className="btn ghost small" onClick={onDownload}>Download</button>
          <a className="btn ghost small" href={avatar.url} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>Open full size</a>
        </div>
      </div>
    </div>
  );
}

function CampaignBoard({ campaign: c, avatar, onRetry, onDownload, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDelete(e) {
    e.stopPropagation();
    if (confirmDelete) { onDelete(c.id); return; }
    setConfirmDelete(true);
    // Auto-reset confirm after 4 seconds
    setTimeout(() => setConfirmDelete(false), 4000);
  }

  return (
    <div className="board">
      <div className="board-head" onClick={() => setExpanded(v => !v)}>
        <div className="board-head-left">
          <h2>{c.product}</h2>
          <span className="board-toggle">{expanded ? "▲ collapse" : "▼ expand"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="concept">{c.copy.concept}</span>
          <button
            className={`camp-del${confirmDelete ? " confirm" : ""}`}
            onClick={handleDelete}
            title={confirmDelete ? "Click again to confirm delete" : "Delete this campaign"}
          >
            {confirmDelete ? "Confirm delete?" : "× Delete"}
          </button>
        </div>
      </div>

      <div className="board-body" style={{ display: expanded ? "block" : "none" }}>
        <div className="board-copy">
          <div className="copy-block"><b>Headline</b><span>{c.copy.headline}</span></div>
          <div className="copy-block"><b>Tagline</b><span>{c.copy.tagline}</span></div>
          <div className="copy-block"><b>Talent</b><span>{c.avatarName}</span></div>
          <div className="copy-block"><b>Tone</b><span>{c.tone}</span></div>
        </div>
        <div className="shots">
          {c.shots.map(s => {
            const meta = SHOTS[s.kind];
            return (
              <div key={s.kind} className="shot">
                {s.status === "done" && s.url ? (
                  <div className="shot-thumb">
                    <img src={s.url} alt={`${c.product} ${meta.label}`} />
                  </div>
                ) : s.status === "failed" ? (
                  <div className="shot-pending">
                    Shot failed<br />
                    <small style={{ maxWidth: "90%", textAlign: "center" }}>{s.error}</small>
                    <button className="btn small" onClick={e => { e.stopPropagation(); onRetry(c.id, s.kind); }}>Retry shot · 30 cr</button>
                  </div>
                ) : (
                  <div className="shot-pending">
                    <span className="spinner" />
                    Rendering {meta.label.toLowerCase()}…
                  </div>
                )}
                <div className="shot-bar">
                  <span>{meta.ar}</span>
                  <span style={{ display: "flex", gap: 10 }}>
                    {s.url && <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); onDownload(s.url, `${c.product}-${s.kind}.png`); }}>download</a>}
                    {s.url && <a href={s.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>open</a>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Video generation panel — always mounted so state survives collapse ── */}
        <VideoPanel campaign={c} avatar={avatar} />
      </div>
    </div>
  );
}

/* ── Video quality tiers ── */
const VIDEO_RESOLUTIONS = [
  { value: "480p",  label: "480p",  tier: "Free"   },
  { value: "720p",  label: "720p",  tier: "Studio+" },
  { value: "1080p", label: "1080p", tier: "Agency"  },
];

function VideoPanel({ campaign: c, avatar }) {
  const [vDuration,    setVDuration]    = useState(5);
  const [vAspectRatio, setVAspectRatio] = useState("16:9");
  const [vResolution,  setVResolution]  = useState("480p");
  const [vStatus,      setVStatus]      = useState(null);
  const [vProgress,    setVProgress]    = useState(0);
  const [vGenerating,  setVGenerating]  = useState(false);
  const [video,        setVideo]        = useState(null); // { url }

  // Adaptive polling: slow down for video (no need to hammer every 3s)
  function pollDelay(iteration) {
    if (iteration < 4)  return 5000;   // 0–20s:  every 5s
    if (iteration < 14) return 8000;   // 20s–2m: every 8s
    return 12000;                      // 2m+:    every 12s
  }

  async function generateVideo() {
    if (!avatar?.url) {
      setVStatus({ kind: "err", html: "Original talent is no longer in your roster — re-cast to generate a video." });
      return;
    }
    setVGenerating(true);
    setVProgress(0);
    setVideo(null);
    setVStatus({ kind: "info", html: "<span class=\"spinner\"></span>Submitting to Seedance 2.0 Fast…" });

    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: {
            product:  c.product,
            concept:  c.copy.concept,
            headline: c.copy.headline,
            tagline:  c.copy.tagline,
            tone:     c.tone,
          },
          // Prefer a campaign shot over the raw avatar — campaign shots already
          // show the model WITH the actual product, giving both character and
          // product consistency in the video.
          avatarUrl: c.shots?.find(s => s.status === "done" && s.url)?.url || avatar.url,
          duration:     vDuration,
          aspect_ratio: vAspectRatio,
          resolution:   vResolution,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seedance submission failed");

      const taskId = data.task_id;
      setVStatus({ kind: "info", html: `<span class="spinner"></span>Queued — waiting for a render slot…` });

      // ── Adaptive polling — max 20 min total ──────────────────────────
      let success = false;   // ← local flag; never read stale React state
      let elapsed = 0;
      let queueMs = 0;
      const MAX_MS = 20 * 60 * 1000;

      for (let i = 0; elapsed < MAX_MS; i++) {
        const delay = pollDelay(i);
        await sleep(delay);
        elapsed += delay;

        const s = await fetch(`/api/video/status?task_id=${taskId}`)
          .then(r => r.json()).catch(() => null);
        if (!s) continue;

        const pct = s.progress ?? 0;
        setVProgress(pct);

        // Track how long we've been waiting in queue
        if (s.state === "waiting" || s.state === "queuing") {
          queueMs += delay;
          const qMin = Math.floor(queueMs / 60000);
          const qSec = Math.floor((queueMs % 60000) / 1000);
          const qLabel = qMin > 0 ? `${qMin}m ${qSec}s` : `${qSec}s`;
          const hint = queueMs > 5 * 60 * 1000
            ? " — kie.ai is busy. You can wait or re-generate later."
            : "";
          setVStatus({ kind: "info", html: `<span class="spinner"></span>In queue (${qLabel})${hint}` });
        } else if (s.state === "generating") {
          queueMs = 0;
          setVStatus({ kind: "info", html: `<span class="spinner"></span>Rendering ${vDuration}s film… ${pct}%` });
        }

        if (s.status === "completed" && s.url) {
          setVProgress(100);
          setVideo({ url: s.url });
          setVStatus(null);
          success = true;   // ← set flag BEFORE break
          break;
        }
        if (s.status === "failed") {
          throw new Error(s.error || "Render failed on kie.ai — please retry.");
        }
      }

      // Only throw if we genuinely timed out — success flag prevents false alarm
      if (!success) {
        throw new Error("Timed out after 20 min — kie.ai queue is very busy. Try again shortly, or choose 5s / 480p for a faster slot.");
      }
    } catch (e) {
      setVStatus({ kind: "err", html: `Video failed: ${e.message}` });
      setVProgress(0);
    }
    setVGenerating(false);
  }

  async function downloadVideo(url) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${c.product}-video-${vDuration}s.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <div className="video-panel" onClick={e => e.stopPropagation()}>
      <div className="video-panel-head">▶ &nbsp;Create Video</div>

      {video ? (
        <div className="video-result">
          <video src={video.url} controls playsInline className="video-player" />
          <div className="video-bar">
            <span>{vAspectRatio} · {vDuration}s · {vResolution}</span>
            <span style={{ display: "flex", gap: 12 }}>
              <a href="#" onClick={e => { e.preventDefault(); downloadVideo(video.url); }}>download</a>
              <a href={video.url} target="_blank" rel="noopener">open</a>
              <a href="#" onClick={e => { e.preventDefault(); setVideo(null); }}>re-generate</a>
            </span>
          </div>
        </div>
      ) : (
        <div className="video-controls">
          <div className="video-opts">
            <div className="vopt-group">
              <label>Duration</label>
              <div className="vopt-pills">
                {[5, 10, 15].map(d => (
                  <button key={d} className={`vopt-pill${vDuration === d ? " active" : ""}`}
                    onClick={() => setVDuration(d)} disabled={vGenerating}>{d}s</button>
                ))}
              </div>
            </div>
            <div className="vopt-group">
              <label>Format</label>
              <div className="vopt-pills">
                {["16:9", "1:1", "9:16"].map(ar => (
                  <button key={ar} className={`vopt-pill${vAspectRatio === ar ? " active" : ""}`}
                    onClick={() => setVAspectRatio(ar)} disabled={vGenerating}>{ar}</button>
                ))}
              </div>
            </div>
            <div className="vopt-group">
              <label>Quality</label>
              <div className="vopt-pills">
                {VIDEO_RESOLUTIONS.map(r => (
                  <button key={r.value} className={`vopt-pill${vResolution === r.value ? " active" : ""}`}
                    onClick={() => setVResolution(r.value)} disabled={vGenerating}>
                    {r.label} <span className="vopt-tier">{r.tier}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button className="btn accent small" style={{ alignSelf: "flex-start" }}
            onClick={generateVideo} disabled={vGenerating}>
            {vGenerating ? <><span className="spinner" />Rendering…</> : "▶  Generate video"}
          </button>
        </div>
      )}

      {vStatus && <div style={{ marginTop: 10 }}><StatusBox status={vStatus} /></div>}
      {vGenerating && vProgress > 0 && (
        <div className="vprogress-track">
          <div className="vprogress-fill" style={{ width: `${vProgress}%` }} />
        </div>
      )}
    </div>
  );
}

function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }

  return (
    <div
      className={`drop-zone${dragging ? " drag-over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={e => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
      <div><strong>Click to upload</strong> or drag your product photo here</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>PNG, JPG, or WebP — keeps packaging exact in the campaign</div>
    </div>
  );
}

function isStripeLink(u) {
  return /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(u || "");
}
