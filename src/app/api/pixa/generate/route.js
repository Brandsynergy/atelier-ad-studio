import { NextResponse } from "next/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

/*
 * ─── MODEL FAMILIES ──────────────────────────────────────────────────────────
 *
 * "seedream-5-pro"  → ByteDance Seedream 5.0 Pro — current flagship on kie.ai
 *   text-to-image : seedream/5-pro-text-to-image
 *   image-to-image: seedream/5-pro-image-to-image   (avatar + product refs)
 *   input field   : image_urls (array of URL strings)
 *   quality tier  : "pro"
 *
 * "gpt-image-2"     → OpenAI GPT Image 2 via kie.ai
 *   text-to-image : gpt/gpt-image-2-text-to-image
 *   image-to-image: gpt-image-2-image-to-image
 *   input field   : input_urls (array of URL strings)
 *   quality tier  : "high"
 *
 * "imagen4-ultra" / "imagen4" / "imagen4-fast" / "nano-banana-2"
 *   → Google Imagen family (existing behaviour, unchanged)
 *   input field   : image_input   + negative_prompt + resolution
 */

function resolveModel(frontendModel, hasImages) {
  switch (frontendModel) {
    case "seedream-5-pro":
      return hasImages
        ? "seedream/5-pro-image-to-image"
        : "seedream/5-pro-text-to-image";
    case "gpt-image-2":
      return hasImages
        ? "gpt-image-2-image-to-image"
        : "gpt/gpt-image-2-text-to-image";
    case "imagen4-ultra":  return "imagen4-ultra";
    case "imagen4":        return "imagen4";
    case "imagen4-fast":   return "imagen4-fast";
    case "nano-banana-2":  return "nano-banana-2";
    default:               return "nano-banana-2";
  }
}

/*
 * ─── NEGATIVE PROMPTS (Imagen family only) ───────────────────────────────────
 * Seedream and GPT Image 2 don't expose a negative_prompt parameter;
 * anatomy & quality blocking is handled in the positive prompt for those models.
 */
const NEG_BASE = [
  // Third-party watermarks & overlays — hard blocked
  "watermark", "logo", "brand watermark", "copyright notice", "photo credit",
  "third-party branding", "app overlay", "PullTube", "Adobe watermark",
  "Getty watermark", "Shutterstock watermark", "stock photo badge",

  // Quality blockers
  "low quality", "blurry", "out of focus", "overexposed", "underexposed",
  "digital artifact", "jpeg artifact", "compression artifact",
  "film grain excess", "noise", "pixelated", "distorted",

  // Anatomy — extra limbs & body parts: hard blocked
  "extra limb", "extra arm", "extra hand", "extra leg", "extra finger",
  "third hand", "third arm", "four hands", "multiple hands",
  "additional hand", "phantom limb", "floating hand", "disembodied hand",
  "disembodied arm", "extra body part", "duplicate limb", "duplicate arm",
  "duplicate hand", "extra appendage", "six fingers", "seven fingers",
  "too many fingers", "too many hands", "too many arms", "too many legs",
  "missing finger", "missing hand", "missing arm", "fused fingers",
  "fused limbs", "merged limbs", "deformed hand", "deformed arm",
  "deformed fingers", "malformed hand", "malformed limb",
  "bad anatomy", "bad proportions", "anatomically incorrect",
  "wrong number of limbs", "mutated limbs", "mutated hands",
  "mutation", "mutated", "poorly drawn hands", "poorly drawn fingers",

  // Face & head
  "extra face", "duplicate face", "two faces", "clone face",
  "distorted face", "disfigured face", "bad face", "ugly",

  // Skin / texture
  "plastic skin", "airbrushed", "over-smoothed", "CGI face", "doll-like",
  "uncanny valley", "artificial look", "painted skin", "wax figure",
].join(", ");

const NEG_TEXT = "text, typography, words, letters, captions, subtitles, overlaid copy, speech bubble, banner text, unintended writing, graffiti, signs with words";

function buildNegativePrompt(isHeroShot) {
  if (isHeroShot) return `${NEG_BASE}, random background text, unintended text, graffiti, third-party watermark`;
  return `${NEG_BASE}, ${NEG_TEXT}`;
}

/*
 * ─── INPUT OBJECT BUILDER ────────────────────────────────────────────────────
 * Each model family expects different field names for reference images.
 */
function buildInput({ frontendModel, imageUrls, prompt, negPrompt, aspectRatio, resolution, outputFormat }) {
  // ── Seedream 5.0 Pro ──
  // The "Pro" tier already implies top quality — no quality param needed.
  // Passing an unknown quality value causes the task to stall in queue.
  if (frontendModel === "seedream-5-pro") {
    const input = {
      prompt,
      aspect_ratio: aspectRatio || "1:1",
    };
    if (imageUrls.length > 0) input.image_urls = imageUrls;
    return input;
  }

  // ── GPT Image 2 ──
  if (frontendModel === "gpt-image-2") {
    const input = {
      prompt,
      aspect_ratio: aspectRatio || "auto",
      quality: "high",
    };
    if (imageUrls.length > 0) input.input_urls = imageUrls;
    return input;
  }

  // ── Imagen family ──
  const input = {
    prompt,
    negative_prompt: negPrompt,
    aspect_ratio: aspectRatio || "auto",
    resolution: resolution || "2K",
    output_format: outputFormat || "png",
  };
  if (imageUrls.length > 0) input.image_input = imageUrls;
  return input;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { model, prompt, aspect_ratio, output_format, attachments, shot_kind, resolution } = body;

    // Extract image URLs from attachments
    const imageUrls = (attachments || [])
      .map(a => a.url || (typeof a.asset_id === "string" && a.asset_id.startsWith("http") ? a.asset_id : null))
      .filter(Boolean);

    const kieModel  = resolveModel(model, imageUrls.length > 0);
    const negPrompt = buildNegativePrompt(shot_kind === "hero");

    const input = buildInput({
      frontendModel: model,
      imageUrls,
      prompt,
      negPrompt,
      aspectRatio:  aspect_ratio,
      resolution,
      outputFormat: output_format,
    });

    const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: kieModel, input }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 200) {
      return NextResponse.json(
        { error: data.msg || `kie.ai error ${res.status}` },
        { status: res.status || 500 }
      );
    }

    const taskId = data.data.taskId;
    return NextResponse.json({ job_id: taskId, asset_ids: [taskId] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
