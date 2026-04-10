# CTWC — Setup Guide

## Step 1 — Copy project to your machine
Move the `ctwc-next/` folder somewhere on your computer (e.g. Desktop).

## Step 2 — Install dependencies
```bash
cd ctwc-next
npm install
```

## Step 3 — Create your Supabase project
1. Go to https://supabase.com and sign up (free)
2. Click **New Project**, name it `ctwc`, pick a region close to you
3. Wait ~2 min for it to spin up
4. Go to **Settings → API** and copy:
   - `Project URL`  →  paste as `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public`  →  paste as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` →  paste as `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## Step 4 — Run the database schema
1. In Supabase, go to **SQL Editor → New query**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run** — this creates all tables and seeds the 32 teams

## Step 5 — Create your .env.local file
```bash
cp .env.local.example .env.local
```
Then open `.env.local` and fill in your real values from Step 3.

## Step 6 — Get X API access (for real card minting)
1. Go to https://developer.twitter.com and apply for Basic access ($100/mo)
2. Create an App, go to **Keys and Tokens**
3. Copy the **Bearer Token** → paste as `X_API_BEARER_TOKEN`

> **No X API yet?** The app still works — cards will just fail to mint
> until you wire in the token. You can test everything else first.

## Step 7 — Run locally
```bash
npm run dev
```
Open http://localhost:3000 — you should see CTWC with teams loaded from Supabase.

## Step 8 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/ctwc.git
git push -u origin main
```

## Step 9 — Deploy to Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New Project** → import your `ctwc` repo
3. In **Environment Variables**, add all 5 keys from your `.env.local`
4. Click **Deploy** — done. Vercel gives you a URL like `ctwc.vercel.app`

## Step 10 — Connect your domain (ctwc.gg)
1. Buy `ctwc.gg` on Namecheap / Cloudflare Registrar
2. In Vercel → your project → **Settings → Domains** → add `ctwc.gg`
3. Vercel gives you DNS records — add them in your registrar
4. SSL is automatic. Live in ~10 min.

---
## What's wired up
- ✅ 32 teams seeded in Supabase
- ✅ Real-time team/roster updates (Supabase subscriptions)
- ✅ Card minting via X API (`/api/mint-card`)
- ✅ Join / leave team (`/api/join-team`)
- ✅ Pool cap enforced server-side (max 400 cards)
- ✅ Row-level security (users can only edit their own card)
- ✅ Auto-deploy on every git push via Vercel
