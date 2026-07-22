import { NextResponse } from "next/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

/**
 * Concise storyboard prompt — shorter = faster generation.
 * Runs server-side only; user never sees this text.
 */
function buildStoryboardPrompt(campaign, duration) {
  const dur = Number(duration) || 5;
  const scenes = {
    5:  "Model holds product confidently toward camera, slow push-in, warm key light on face and product label.",
    10: "Opens on model in brand environment; at midpoint model presents product with natural gesture, camera glides in on detail.",
    15: "Three beats: mood and character established; model interacts with product naturally; closes on face and product hero shot with direct gaze.",
  };
  return (
    `Luxury ad film for "${campaign.product}". ${campaign.tone} aesthetic. ` +
    `Maintain the exact face, skin, and hair of the person in the reference image throughout — character consistency is paramount. ` +
    `${scenes[dur]} ` +
    `Concept: ${campaign.concept}. ` +
    `Cinematic, shallow depth of field, premium commercial quality.`
  );
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { campaign, avatarUrl, duration, aspect_ratio, resolution } = body;

    if (!avatarUrl) {
      return NextResponse.json({ error: "Avatar URL required for character consistency." }, { status: 400 });
    }

    const prompt = buildStoryboardPrompt(campaign, duration);

    const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "bytedance/seedance-2-fast",
        input: {
          prompt,
          first_frame_url: avatarUrl,
          duration:     Number(duration) || 5,
          aspect_ratio: aspect_ratio || "16:9",
          resolution:   resolution || "480p",
          generate_audio: true,
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
