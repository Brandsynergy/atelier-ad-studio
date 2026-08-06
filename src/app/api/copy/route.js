import { NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Smart fallback copy when no Anthropic key is available
function fallbackCopy(product, tone) {
  const toneMap = {
    "Luxury / premium": { headline: "Pure Prestige", tagline: "Crafted for those who demand the finest." },
    "Minimalist / clean": { headline: "Simply Perfect", tagline: "Nothing more. Nothing less." },
    "Bold / high-energy": { headline: "Own the Moment", tagline: "For those who never stand still." },
    "Warm / natural": { headline: "Real Beauty", tagline: "Nature's best, beautifully yours." },
    "Tech / futuristic": { headline: "Beyond Today", tagline: "Engineered for tomorrow's world." },
    "Playful / youthful": { headline: "Life is Short", tagline: "Make every moment count." },
  };
  const t = toneMap[tone] || { headline: product, tagline: "Made to be noticed." };
  return {
    concept: `A confident, premium showcase of ${product} built around one unforgettable face.`,
    headline: t.headline,
    tagline: t.tagline,
    scenes: {
      hero: "cinematic lifestyle environment that fits the product, model naturally engaging with the product as the focal point, generous negative space on one side for the headline",
      social: "clean studio composition, model holding or presenting the product close to camera, product label crisp and readable",
      story: "vertical full-length composition, model mid-action using the product in a real moment, energy and movement",
    },
  };
}

export async function POST(request) {
  try {
    const { product, desc, tone, setting } = await request.json();

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(fallbackCopy(product, tone));
    }

    const systemPrompt = `You are a creative director at a top global advertising agency. Return ONLY valid JSON (no markdown, no explanation) with these exact keys:
- "concept": one sentence campaign concept
- "headline": max 5 words, punchy and memorable
- "tagline": max 8 words, emotive brand line
- "scenes": object with keys "hero", "social", "story" — each a vivid one-sentence photography scene description. hero=16:9 billboard, social=1:1 feed, story=9:16 vertical. All scenes feature the model interacting with the product.`;

    const userContent = `Product: ${product}\nDescription: ${desc || "n/a"}\nBrand tone: ${tone}\nSetting preference: ${setting}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(fallbackCopy(product, tone));
    }

    const anthropicData = await res.json();
    const text = anthropicData.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    if (parsed.concept && parsed.headline && parsed.scenes?.hero) {
      return NextResponse.json(parsed);
    }
    return NextResponse.json(fallbackCopy(product, tone));
  } catch (err) {
    // Never fail the campaign over copy — fall back gracefully
    const { product, tone } = await request.json().catch(() => ({ product: "Product", tone: "Luxury / premium" }));
    return NextResponse.json(fallbackCopy(product, tone));
  }
}
