-- 009: corrections that keep history, patient merge and duplicate finder, atomic visit save, nightly snapshots

-- ---------- corrections ----------
alter table visit_notes   add column edited_at timestamptz, add column edited_by uuid references profiles on delete set null;
alter table prescriptions add column edited_at timestamptz, add column edited_by uuid references profiles on delete set null;
alter table referrals     add column edited_at timestamptz, add column edited_by uuid references profiles on delete set null;

-- A change to the content is stamped. If someone other than the author changes a confirmed entry, it goes back to review.
-- The previous wording is always kept in audit_log.
create function mark_edited() returns trigger language plpgsql set search_path = public as $$
declare skip text[] := array['entry_type','confirmed_by','confirmed_at','edited_at','edited_by'];
begin
  if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
    new.edited_at := now(); new.edited_by := auth.uid();
    if old.entry_type = 'confirmed' and auth.uid() is distinct from old.author_id then
      new.entry_type := 'on_behalf_pending'; new.confirmed_by := null; new.confirmed_at := null;
    end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['visit_notes','prescriptions','referrals'] loop
    execute format('create trigger %I_mark_edited before update on %I for each row execute function mark_edited()', t, t);
  end loop;
end $$;

-- ---------- merge duplicate patients ----------
create function merge_patients(p_keep uuid, p_remove uuid) returns void language plpgsql security definer set search_path = public as $$
declare k patients%rowtype; r patients%rowtype; moved int;
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  if p_keep = p_remove then raise exception 'Choose two different patients'; end if;
  select * into k from patients where id = p_keep for update;
  select * into r from patients where id = p_remove for update;
  if k.id is null or r.id is null then raise exception 'Patient not found'; end if;
  if k.is_demo <> r.is_demo then raise exception 'A demo patient cannot be merged with a real one'; end if;
  update visits set patient_id = p_keep where patient_id = p_remove;
  get diagnostics moved = row_count;
  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data, is_demo)
  values (auth.uid(), 'MERGE', 'patients', p_remove, to_jsonb(r), jsonb_build_object('merged_into', p_keep, 'visits_moved', moved), k.is_demo);
  delete from patients where id = p_remove;
  update patients set staff_id = coalesce(k.staff_id, r.staff_id), sex = coalesce(k.sex, r.sex),
    date_of_birth = coalesce(k.date_of_birth, r.date_of_birth), approx_age = coalesce(k.approx_age, r.approx_age),
    phone = coalesce(k.phone, r.phone), department_id = coalesce(k.department_id, r.department_id), consent = coalesce(k.consent, r.consent)
  where id = p_keep;
end $$;

create function find_duplicate_patients() returns table (id_a uuid, name_a text, dept_a text, visits_a bigint, id_b uuid, name_b text, dept_b text, visits_b bigint, score real)
language plpgsql stable security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  return query
  select a.id, a.full_name, da.name, (select count(*) from visits v where v.patient_id = a.id),
         b.id, b.full_name, db.name, (select count(*) from visits v where v.patient_id = b.id), similarity(a.full_name, b.full_name)
  from patients a join patients b on a.id < b.id and a.is_demo = b.is_demo and a.full_name % b.full_name
  left join departments da on da.id = a.department_id left join departments db on db.id = b.department_id
  where similarity(a.full_name, b.full_name) >= 0.6 and (a.staff_id is null or b.staff_id is null or a.staff_id = b.staff_id)
  order by 9 desc limit 100;
end $$;

-- ---------- one visit, saved all together or not at all ----------
create function save_visit(p jsonb) returns uuid language plpgsql set search_path = public as $$
declare vid uuid; n jsonb; v jsonb := p->'vitals'; at timestamptz;
begin
  if not is_clinician() then raise exception 'Not allowed'; end if;
  at := coalesce((p->>'visit_at')::timestamptz, now());
  insert into visits (patient_id, visit_at, major_concern, remark, created_by)
  values ((p->>'patient_id')::uuid, at, nullif(p->>'major_concern', ''), nullif(p->>'remark', ''), auth.uid()) returning id into vid;
  if jsonb_typeof(v) = 'object' then
    insert into vitals (visit_id, bp_systolic, bp_diastolic, pulse, temp_c, weight_kg, rbs_mgdl, recorded_at, recorded_by)
    values (vid, (v->>'bp_s')::smallint, (v->>'bp_d')::smallint, (v->>'pulse')::smallint, (v->>'temp')::numeric, (v->>'weight')::numeric, (v->>'rbs')::numeric, at, auth.uid());
  end if;
  for n in select * from jsonb_array_elements(coalesce(p->'notes', '[]')) loop
    insert into visit_notes (visit_id, kind, body, entry_type, author_id)
    values (vid, (n->>'kind')::note_kind_t, n->>'body', coalesce((n->>'entry_type')::entry_type_t, 'original'), nullif(n->>'author_id', '')::uuid);
  end loop;
  for n in select * from jsonb_array_elements(coalesce(p->'prescriptions', '[]')) loop
    insert into prescriptions (visit_id, drug, dose, frequency, duration, entry_type, author_id)
    values (vid, n->>'drug', nullif(n->>'dose', ''), nullif(n->>'frequency', ''), nullif(n->>'duration', ''), coalesce((n->>'entry_type')::entry_type_t, 'original'), nullif(n->>'author_id', '')::uuid);
  end loop;
  for n in select * from jsonb_array_elements(coalesce(p->'referrals', '[]')) loop
    insert into referrals (visit_id, destination, reason, entry_type, author_id)
    values (vid, n->>'destination', nullif(n->>'reason', ''), coalesce((n->>'entry_type')::entry_type_t, 'original'), nullif(n->>'author_id', '')::uuid);
  end loop;
  return vid;
end $$;

-- ---------- backups ----------
create table backup_snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  counts jsonb not null,
  data jsonb not null
);
alter table backup_snapshots enable row level security;
revoke all on backup_snapshots from anon, authenticated;

-- Everything that matters, as one JSON document. Secrets (Vault) and login credentials are never included.
create function build_backup() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('taken_at', now(), 'schema_version', 9,
    'departments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from departments t),
    'beds', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from beds t),
    'patients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from patients t),
    'visits', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from visits t),
    'vitals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from vitals t),
    'visit_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from visit_notes t),
    'prescriptions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from prescriptions t),
    'referrals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from referrals t),
    'bed_stays', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from bed_stays t),
    'reports', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from reports t),
    'report_emails', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from report_emails t),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from profiles t),
    'staff_invites', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from staff_invites t),
    'ai_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from ai_settings t),
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from app_settings t),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from audit_log t))
$$;

create function export_backup() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  insert into audit_log (user_id, action, table_name) values (auth.uid(), 'EXPORT_BACKUP', 'backup');
  return build_backup();
end $$;

create function take_snapshot() returns void language plpgsql security definer set search_path = public as $$
declare d jsonb := build_backup();
begin
  insert into backup_snapshots (counts, data)
  values (jsonb_build_object('patients', jsonb_array_length(d->'patients'), 'visits', jsonb_array_length(d->'visits'), 'reports', jsonb_array_length(d->'reports')), d);
  delete from backup_snapshots where taken_at < now() - interval '14 days' and id not in (select id from backup_snapshots order by taken_at desc limit 5);
end $$;

create function list_snapshots() returns table (id bigint, taken_at timestamptz, counts jsonb, size_kb int) language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  return query select s.id, s.taken_at, s.counts, (pg_column_size(s.data) / 1024)::int from backup_snapshots s order by s.taken_at desc limit 20;
end $$;
create function get_snapshot(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  insert into audit_log (user_id, action, table_name, new_data) values (auth.uid(), 'EXPORT_SNAPSHOT', 'backup', jsonb_build_object('snapshot', p_id));
  return (select data from backup_snapshots where id = p_id);
end $$;

create extension if not exists pg_cron;
select cron.schedule('daily-snapshot', '0 1 * * *', 'select public.take_snapshot()');   -- 01:00 UTC = 02:00 Lagos
select public.take_snapshot();

-- ---------- privileges ----------
revoke execute on function mark_edited(), build_backup(), take_snapshot(), merge_patients(uuid, uuid), find_duplicate_patients(), save_visit(jsonb),
  export_backup(), list_snapshots(), get_snapshot(bigint) from public, anon, authenticated;
grant execute on function merge_patients(uuid, uuid), find_duplicate_patients(), save_visit(jsonb), export_backup(), list_snapshots(), get_snapshot(bigint) to authenticated;
