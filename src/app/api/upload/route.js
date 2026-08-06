import { NextResponse } from "next/server";

export const runtime = "nodejs";

const KIE_UPLOAD = "https://kieai.redpandaai.co/api/file-stream-upload";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    // Forward the file as multipart to kie.ai's stream upload endpoint
    const kieForm = new FormData();
    kieForm.append("file", file, file.name);
    kieForm.append("uploadPath", "images/product-uploads");
    kieForm.append("fileName", file.name);

    const res = await fetch(KIE_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`,
        // Do NOT set Content-Type — fetch sets it automatically with the correct boundary
      },
      body: kieForm,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.msg || `kie.ai upload failed: ${res.status}`);
    }

    // Return the CDN download URL as "asset_id" so the campaign generator can reference it
    return NextResponse.json({
      asset_id: data.data.downloadUrl,
      filename: data.data.fileName,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
