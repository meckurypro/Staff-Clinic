# Staff Clinic

Mobile-first staff clinic records app (React + TypeScript + Vite) on Supabase, deployed on Vercel.
Edge functions live in Supabase, not in this repo. This repo is the frontend plus the database migration.

## Setup
1. Create a Supabase project and run `supabase/migrations/001_boi_clinic_schema.sql` in the SQL editor.
2. Authentication > Add user for each person, and turn off public signups. Then link each login to a profile (see the end of the SQL file).
3. `cp .env.example .env` and fill in the project URL and anon key.
4. `npm install && npm run dev`

## Deploy (Vercel)
Import the repo. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Project Settings. `vercel.json` handles routing.

## Data
Use fictional data only until written approval is in place. Seed patients are flagged `is_demo` and can be removed with `select clear_demo_data();` as an admin.
