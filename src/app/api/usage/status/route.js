import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";

/*
 * Tier limits:
 *   free    — 1 model cast, 5 campaigns (lifetime, no reset)
 *   starter — 3 models,  5 campaigns  (resets monthly)
 *   studio  — 15 models, 30 campaigns (resets monthly)
 *   agency  — unlimited
 */
const LIMITS = {
  free:    { models: 1,    campaigns: 5,   monthly: false },
  starter: { models: 3,    campaigns: 5,   monthly: true  },
  studio:  { models: 15,   campaigns: 30,  monthly: true  },
  agency:  { models: null, campaigns: null, monthly: true  },
};

function periodExpired(periodStart) {
  if (!periodStart) return true;
  const elapsed = Date.now() - new Date(periodStart).getTime();
  return elapsed >= 30 * 24 * 60 * 60 * 1000; // 30 days
}

export async function GET() {
  try {
    const { userId } = auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await clerkClient.users.getUser(userId);
    let meta = { ...user.publicMetadata };

    const tier  = (meta.tier  || "free");
    const limit = LIMITS[tier] || LIMITS.free;

    let models_used    = Number(meta.models_used    || 0);
    let campaigns_used = Number(meta.campaigns_used || 0);
    let period_start   = meta.period_start || null;

    // Monthly reset for paid tiers
    if (limit.monthly && periodExpired(period_start)) {
      models_used    = 0;
      campaigns_used = 0;
      period_start   = new Date().toISOString();
      await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata: { ...meta, models_used: 0, campaigns_used: 0, period_start },
      });
    }

    return NextResponse.json({
      tier,
      models_used,
      campaigns_used,
      limits: {
        models:    limit.models,
        campaigns: limit.campaigns,
      },
      // Convenience booleans used by the client-side pre-flight checks
      models_ok:    limit.models    === null || models_used    < limit.models,
      campaigns_ok: limit.campaigns === null || campaigns_used < limit.campaigns,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
