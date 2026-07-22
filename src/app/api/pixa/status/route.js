import { NextResponse } from "next/server";

const KIE_BASE = "https://api.kie.ai/api/v1";

function mapState(state) {
  if (state === "success") return "completed";
  if (state === "fail")    return "failed";
  return "processing"; // waiting, queuing, generating
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("job_id");
    if (!jobId) return NextResponse.json({ error: "Missing job_id" }, { status: 400 });

    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${jobId}`, {
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: data.msg || `kie.ai error ${res.status}` }, { status: res.status });

    const task = data.data || {};
    return NextResponse.json({
      status:   mapState(task.state),
      state:    task.state,             // raw: waiting | queuing | generating | success | fail
      progress: task.progress ?? 0,     // 0-100
      error:    task.failMsg || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
