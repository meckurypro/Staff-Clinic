# Staff Clinic

Mobile-first staff clinic records app (React + TypeScript + Vite) on Supabase, deployed on Vercel.
Edge functions live in Supabase, not in this repo. This repo is the frontend plus the database migration.

## Setup
1. In Supabase, apply `supabase/migrations/001`, `002`, `003` in order (SQL editor or MCP) and deploy `supabase/functions/ai-test`.
2. Authentication: keep email confirmation on, set Site URL and Redirect URLs to your Vercel domain, and (recommended) enable the Before User Created hook with `public.hook_restrict_signup`. The first admin invite is seeded in migration 002; add the doctor and safety manager from the Admin page, then each sets a password on the sign-in page.
3. `cp .env.example .env` and fill in the project URL and anon key.
4. `npm install && npm run dev`

## Deploy (Vercel)
Import the repo. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Project Settings. `vercel.json` handles routing.

## Data
Use fictional data only until written approval is in place. Seed patients are flagged `is_demo` and can be removed with `select clear_demo_data();` as an admin.
