import { NextResponse } from "next/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

// GET /api/pixa/assets?action=get&asset_id=<taskId>
// The asset_id is the kie.ai taskId — we fetch the task record to get the result URL.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action  = searchParams.get("action") || "get";
    const assetId = searchParams.get("asset_id");

    if (action === "get" && assetId) {
      const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${assetId}`, {
        headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return NextResponse.json({ error: data.msg || `kie.ai error ${res.status}` }, { status: res.status });

      const task = data.data;

      if (task.state === "fail") {
        return NextResponse.json({ status: "failed", error_message: task.failMsg || "Generation failed" });
      }
      if (task.state !== "success") {
        return NextResponse.json({ status: "processing" });
      }

      // resultJson contains { "resultUrls": ["https://..."] }
      let url = null;
      try {
        const result = JSON.parse(task.resultJson);
        url = result.resultUrls?.[0] ?? null;
      } catch {}

      return NextResponse.json({
        status: "ready",
        id: assetId,
        url,
        thumbnail_url: url,
      });
    }

    // list action — return empty (library panel degrades gracefully)
    return NextResponse.json({ items: [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  // download URL — just return the url directly from the task record
  try {
    const { asset_id } = await request.json();
    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${asset_id}`, {
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
    });
    const data = await res.json().catch(() => ({}));
    let url = null;
    try { url = JSON.parse(data.data?.resultJson)?.resultUrls?.[0] ?? null; } catch {}
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
