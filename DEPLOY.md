# Atelier Ad Studio — Deployment Guide

## What you need before you start
1. A **Pixa** account with an API key (create one at pixa.com → Settings → API Keys)
2. A free **Vercel** account (vercel.com)
3. Optional: an **Anthropic** API key for AI-written headlines (console.anthropic.com)

---

## Step 1 — Upload the project to GitHub

1. Go to [github.com](https://github.com) → New repository → call it `atelier-ad-studio`
2. On your computer, unzip this folder
3. Drag the entire `atelier-standalone` folder into the GitHub repository

---

## Step 2 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → Add New → Project
2. Connect your GitHub account and select `atelier-ad-studio`
3. Click **Deploy** — Vercel will detect Next.js automatically

---

## Step 3 — Add your API keys (this is the important step)

After deploying, go to Vercel → your project → **Settings → Environment Variables** and add:

| Key | Value | Where to get it |
|-----|-------|-----------------|
| `PIXA_API_KEY` | `pk_live_xxxx…` | pixa.com → Settings → API Keys |
| `ANTHROPIC_API_KEY` | `sk-ant-xxxx…` | console.anthropic.com → API Keys |

Then go to **Deployments** → click the three dots on your latest deploy → **Redeploy**.

Your app is now live at `https://your-project.vercel.app` — share that URL with customers.

---

## Step 4 — Connect Stripe (optional, for paid plans)

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Products → Add Product → set name and price
3. Create a Payment Link for each product
4. In your live Atelier app → Pricing tab → Configure plans → paste the Stripe links

---

## Notes

- **No Claude account required** — customers use the app directly in any browser
- **File uploads work natively** — the drag-and-drop product photo zone sends files straight to Pixa
- **Roster and campaigns are saved per-browser** — each customer's work stays private on their device
- The app runs entirely on Vercel's serverless infrastructure — no servers to manage
