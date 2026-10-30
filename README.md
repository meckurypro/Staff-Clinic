# Staff Clinic

Mobile-first staff clinic records app (React + TypeScript + Vite) on Supabase, deployed on Vercel.
Edge functions live in Supabase, not in this repo. This repo is the frontend plus the database migration.

## Setup
1. In Supabase, apply `supabase/migrations/001` to `010` in order (SQL editor or MCP) and deploy `supabase/functions/ai-test` and `generate-report`.
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

## PDF, email and the doctor's Google Sheet
- Final reports download as Word or PDF (both generated in the browser).
- Email: Admin > Email reports. Add a Resend API key, a sender address on a domain verified in Resend, and the approved recipients. `send-report` only mails addresses on that list, only for final reports, and logs every send.
- Google Sheet: Admin > Google Sheet. Create a Google Cloud service account with the Sheets API enabled, paste its JSON key, share the sheet with the service account email as Editor, and enter the sheet ID. Every saved visit is queued by the database (`sheet_outbox`) and appended to the "Clinic records" tab as one new row; if Google is unreachable it stays queued and goes out on the next save or with "Send waiting visits". "Rebuild whole sheet" rewrites the tab after corrections. Demo patients and bulk imports are never queued. Run `npm run test:sheets` to test the sheet code against a fake Google server.
- Keys are stored in Supabase Vault and are never readable from the browser.

## Daily use features
- **Edit details and merge duplicates:** patient page > Edit details; admins can merge a duplicate there or from Admin > Possible duplicate patients. Merges are logged.
- **Corrections:** any note, prescription or visit detail can be corrected; the earlier wording stays in the audit trail, and a confirmed entry changed by someone else goes back to review.
- **Review:** entries recorded on a colleague's behalf appear under Review, with a count badge.
- **Bed rest:** admit with a reason; discharge with an outcome (back to work, sent home, referred).
- **Admin > Clinic setup:** departments, beds and the "require staff ID" switch.
- **Installable and flaky-connection friendly:** add to the home screen; a visit saves completely or not at all (`save_visit`), and an offline banner explains why nothing can be saved.
- **Backups:** nightly in-database snapshots plus a downloadable full backup; see `docs/RECOVERY.md`.
