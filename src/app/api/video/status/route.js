import { NextResponse } from "next/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

function mapState(state) {
  if (state === "success") return "completed";
  if (state === "fail")    return "failed";
  return "processing";
}

export async function GET(request) {
  try {
    const taskId = new URL(request.url).searchParams.get("task_id");
    if (!taskId) {
      return NextResponse.json({ error: "task_id required" }, { status: 400 });
    }

    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
    });

    const data = await res.json().catch(() => ({}));
    const task = data.data || {};

    let videoUrl = null;
    if (task.state === "success") {
      try {
        videoUrl = JSON.parse(task.resultJson)?.resultUrls?.[0] ?? null;
      } catch {}
    }

    return NextResponse.json({
      status:   mapState(task.state),
      state:    task.state,          // raw: waiting | queuing | generating | success | fail
      progress: task.progress ?? 0,  // 0-100 — show real render progress to user
      url:      videoUrl,
      error:    task.failMsg || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
