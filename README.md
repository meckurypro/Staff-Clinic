# Staff Clinic

Mobile-first staff clinic records app (React + TypeScript + Vite) on Supabase, deployed on Vercel.
Edge functions live in Supabase, not in this repo. This repo is the frontend plus the database migration.

## Setup
1. In Supabase, apply `supabase/migrations/001` to `005` in order (SQL editor or MCP) and deploy `supabase/functions/ai-test` and `generate-report`.
2. Authentication: keep email confirmation on, set Site URL and Redirect URLs to your Vercel domain, and (recommended) enable the Before User Created hook with `public.hook_restrict_signup`. The first admin invite is seeded in migration 002; add the doctor and safety manager from the Admin page, then each sets a password on the sign-in page.
3. `cp .env.example .env` and fill in the project URL and anon key.
4. `npm install && npm run dev`

## Deploy (Vercel)
Import the repo. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Project Settings. `vercel.json` handles routing.

## Data
Use fictional data only until written approval is in place. Seed patients are flagged `is_demo` and can be removed with `select clear_demo_data();` as an admin.

## Sick Bay report
Reports > Generate report builds the Word report in the safety manager's format. Figures are computed in the database (`report_snapshot`); the narrative is drafted from totals only by the AI model chosen on the Admin page. `public/sick-bay-template.docx` is a blank copy of the template (no patient data); replace it to change the layout.

## Importing the old Excel sheet
Admin > Import from Excel reads the consultation sheet in the browser, lets you review departments, then imports through `import_clinic_data` (admin only, safe to run twice). Only do this once BOI has approved storing the records here.
