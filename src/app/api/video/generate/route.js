import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

/**
 * Builds a tightly-directed storyboard prompt.
 * The reference image (first_frame_url) is the campaign HERO SHOT —
 * it already shows the correct model AND the correct product together.
 * The prompt reinforces both throughout every sentence.
 */
function buildStoryboardPrompt(campaign, duration) {
  const dur     = Number(duration) || 5;
  const product = campaign.product;
  const tone    = campaign.tone || "luxury";
  const concept = campaign.concept || "";
  const headline = campaign.headline || "";

  const scenes = {
    5: (
      `The model from the reference image holds the ${product} product prominently in front of the camera. ` +
      `The product packaging and label face the viewer clearly throughout. ` +
      `Slow cinematic push-in. Warm key light on both the model's face and the ${product} label.`
    ),
    10: (
      `Opens on the exact model from the reference image standing in a brand environment. ` +
      `At the midpoint the model raises the ${product}, presenting it directly to camera with the label fully visible. ` +
      `Camera glides in to a close detail of the ${product} packaging. ` +
      `The ${product} is present and legible in every shot.`
    ),
    15: (
      `Three-beat structure. ` +
      `Beat 1: the model from the reference image establishes mood — ${tone} aesthetic, brand environment. ` +
      `Beat 2: model holds and interacts with the ${product}; product label faces camera; lighting highlights the packaging. ` +
      `Beat 3: tight hero shot — model's face and the ${product} together, direct gaze, product label front and centre. ` +
      `The ${product} must be clearly visible and identifiable in every beat.`
    ),
  };

  return (
    // Identity lock
    `Luxury advertising film. Product: ${product}. ` +
    `REFERENCE IMAGE IS LAW: The first frame of this video is the campaign hero shot. ` +
    `Maintain the exact model — same face, skin tone, hair, and physique — in every frame without exception. ` +
    `Maintain the exact ${product} product — same packaging, colours, label, and shape — in every frame without exception. ` +
    `No substitutions. No invented props. No different faces. No different products. ` +
    // Scene direction
    `${scenes[dur]} ` +
    // Brand direction
    `Brand tone: ${tone}. ${concept ? `Concept: ${concept}. ` : ""}${headline ? `Campaign line: "${headline}". ` : ""}` +
    // Technical direction
    `Cinematic. Shallow depth of field. Premium commercial quality. ` +
    `This is a high-budget global advertising campaign — every frame must be impeccable.`
  );
}

export async function POST(request) {
  try {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await request.json();
    const { campaign, avatarUrl, duration, aspect_ratio, resolution } = body;

    if (!avatarUrl) {
      return NextResponse.json({ error: "No reference image available. Generate campaign shots first." }, { status: 400 });
    }

    const prompt = buildStoryboardPrompt(campaign, duration);

    const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "bytedance/seedance-1.5-pro",
        input: {
          prompt,
          first_frame_url: avatarUrl,
          duration:        Number(duration) || 5,
          aspect_ratio:    aspect_ratio || "16:9",
          resolution:      resolution   || "480p",
          generate_audio:  true,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 200) {
      return NextResponse.json(
        { error: data.msg || `kie.ai Seedance error ${res.status}` },
        { status: res.status || 500 }
      );
    }

    return NextResponse.json({ task_id: data.data.taskId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
