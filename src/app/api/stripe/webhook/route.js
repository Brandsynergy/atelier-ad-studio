import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

/*
 * Maps Stripe Price IDs → Atelier tier names.
 * Fill STRIPE_STARTER_PRICE_ID, STRIPE_STUDIO_PRICE_ID, STRIPE_AGENCY_PRICE_ID
 * in the Render dashboard after creating your Stripe products.
 */
function priceToTier(priceId) {
  const map = {
    [process.env.STRIPE_STARTER_PRICE_ID]: "starter",
    [process.env.STRIPE_STUDIO_PRICE_ID]:  "studio",
    [process.env.STRIPE_AGENCY_PRICE_ID]:  "agency",
  };
  return map[priceId] || null;
}

async function upgradeUser(email, tier) {
  const result = await clerkClient.users.getUserList({ emailAddress: [email] });
  const user   = result.data?.[0] || result[0];
  if (!user) { console.warn(`[webhook] No Clerk user found for email: ${email}`); return; }

  await clerkClient.users.updateUserMetadata(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      tier,
      models_used:    0,
      campaigns_used: 0,
      period_start:   new Date().toISOString(),
    },
  });
  console.log(`[webhook] Upgraded ${email} → ${tier}`);
}

async function downgradeUser(email) {
  const result = await clerkClient.users.getUserList({ emailAddress: [email] });
  const user   = result.data?.[0] || result[0];
  if (!user) { console.warn(`[webhook] No Clerk user found for email: ${email}`); return; }

  await clerkClient.users.updateUserMetadata(user.id, {
    publicMetadata: { ...user.publicMetadata, tier: "free" },
  });
  console.log(`[webhook] Downgraded ${email} → free`);
}

export async function POST(req) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    // ── Successful checkout (Payment Links fire this event) ──────────────
    if (event.type === "checkout.session.completed") {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ["line_items"],
      });

      const email   = session.customer_details?.email;
      const priceId = session.line_items?.data?.[0]?.price?.id;
      const tier    = priceToTier(priceId);

      if (email && tier) await upgradeUser(email, tier);
    }

    // ── Subscription renewed / plan changed ─────────────────────────────
    if (event.type === "customer.subscription.updated") {
      const sub    = event.data.object;
      const stripe_ = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe_.customers.retrieve(sub.customer);
      const priceId  = sub.items?.data?.[0]?.price?.id;
      const tier     = priceToTier(priceId);
      if (customer.email && tier) await upgradeUser(customer.email, tier);
    }

    // ── Subscription cancelled / expired ────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const sub      = event.data.object;
      const stripe_  = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe_.customers.retrieve(sub.customer);
      if (customer.email) await downgradeUser(customer.email);
    }
  } catch (err) {
    // Log but return 200 so Stripe doesn't keep retrying
    console.error("[webhook] Handler error:", err);
  }

  return NextResponse.json({ received: true });
}
