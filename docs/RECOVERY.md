# Recovering records

There are three layers of protection, from smallest to largest problem.

1. **Corrections are never overwrites.** Every edit, merge and delete is kept in `audit_log` with the previous values (Admin > Audit trail).
2. **Nightly snapshots** (`backup_snapshots`, 14 days, taken at 02:00 Lagos time by `pg_cron`). Use these after an accidental bulk delete or a bad import.
3. **Downloaded backups** (Admin > Backups > Download full backup). Use these if the Supabase project itself is lost. Download one weekly and keep it on an access-controlled drive. The Supabase free plan has no point-in-time recovery; upgrading the plan adds it.

## Restoring from a snapshot or downloaded file

Run in the Supabase SQL editor. This was tested on a copy of the data. Restore parents before children, and only the tables you need.

```sql
-- 1. Put the JSON in a variable (a snapshot, or paste a downloaded backup between the quotes).
select data from backup_snapshots order by taken_at desc limit 1;   -- note the id you want

begin;
set local session_replication_role = replica;   -- skips triggers so history is not rewritten
-- for a full restore, empty the tables first; for a partial one, skip this
-- delete from patients;   (cascades to visits, notes, prescriptions, referrals, vitals, bed stays)

with s as (select data as d from backup_snapshots where id = 1)   -- change the id
insert into patients select * from s, jsonb_populate_recordset(null::patients, s.d->'patients');
-- repeat for: visits, vitals, visit_notes, prescriptions, referrals, bed_stays, reports, report_emails
commit;
```

After a restore: sign in, check a few patients, and note the restore in your own records. Vault secrets (AI, email and Google keys) are not part of any backup; re-enter them on the Admin page.
