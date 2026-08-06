import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";

// POST { type: "model" | "campaign" }
// Increments the matching counter in Clerk public metadata.
export async function POST(request) {
  try {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { type } = await request.json();
    if (type !== "model" && type !== "campaign") {
      return NextResponse.json({ error: "type must be 'model' or 'campaign'" }, { status: 400 });
    }

    const user = await clerkClient.users.getUser(userId);
    const meta = { ...user.publicMetadata };

    const update = {};
    if (type === "model")    update.models_used    = (Number(meta.models_used    || 0)) + 1;
    if (type === "campaign") update.campaigns_used = (Number(meta.campaigns_used || 0)) + 1;

    // Initialise tier and period_start on first usage if not already set
    if (!meta.tier)         update.tier         = "free";
    if (!meta.period_start) update.period_start = new Date().toISOString();

    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: { ...meta, ...update },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
