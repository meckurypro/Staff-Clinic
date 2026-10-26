-- BOI Staff Clinic: initial schema (Supabase / PostgreSQL). Fictional seed data only.
create extension if not exists pg_trgm;

create type user_role   as enum ('nurse','doctor','safety_manager');
create type sex_t       as enum ('male','female');
create type consent_t   as enum ('yes','no','not_required');
create type entry_type_t as enum ('original','transcribed','on_behalf_pending','confirmed');
create type note_kind_t as enum ('complaint','nursing','medical','diagnosis','advice');
create type outcome_t   as enum ('back_to_work','sent_home','referred');

-- ---------- people & settings ----------
create table profiles (
  id uuid primary key references auth.users on delete restrict,
  full_name text not null,
  role user_role not null,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table app_settings (key text primary key, value jsonb not null);
insert into app_settings values ('require_staff_id', 'false'::jsonb);  -- flip to true if BOI adopts the app

create table departments (id serial primary key, name text unique not null, active boolean not null default true);
create table beds (id serial primary key, name text unique not null, room text not null, active boolean not null default true);

-- ---------- helpers ----------
create function auth_role() returns user_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and is_active $$;
create function auth_is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid() and is_active), false) $$;
create function is_clinician() returns boolean language sql stable as
$$ select auth_role() in ('nurse','doctor') $$;

-- ---------- clinical tables ----------
create table patients (
  id uuid primary key default gen_random_uuid(),
  staff_id text unique,                       -- optional for now
  full_name text not null,
  sex sex_t,
  date_of_birth date,
  approx_age smallint,
  phone text,
  department_id int references departments,
  consent consent_t,
  is_demo boolean not null default false,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);
create index patients_name_trgm on patients using gin (full_name gin_trgm_ops);

create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  visit_at timestamptz not null default now(),
  plan_accepted boolean,
  is_demo boolean not null default false,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);
create index visits_patient on visits (patient_id, visit_at desc);

create table vitals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  bp_systolic smallint, bp_diastolic smallint, pulse smallint,
  temp_c numeric(3,1), weight_kg numeric(5,1), rbs_mgdl numeric(5,1),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references profiles,
  is_demo boolean not null default false
);

-- Attribution columns: entered_by = who typed it; author_id = who made the clinical decision.
create table visit_notes (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  kind note_kind_t not null,
  body text not null,
  entered_by uuid references profiles, author_id uuid references profiles,
  entry_type entry_type_t not null default 'original',
  confirmed_by uuid references profiles, confirmed_at timestamptz,
  created_at timestamptz not null default now(), is_demo boolean not null default false
);
create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  drug text not null, dose text, frequency text, duration text,
  entered_by uuid references profiles, author_id uuid references profiles,
  entry_type entry_type_t not null default 'original',
  confirmed_by uuid references profiles, confirmed_at timestamptz,
  created_at timestamptz not null default now(), is_demo boolean not null default false
);
create table referrals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  destination text, reason text,
  entered_by uuid references profiles, author_id uuid references profiles,
  entry_type entry_type_t not null default 'original',
  confirmed_by uuid references profiles, confirmed_at timestamptz,
  created_at timestamptz not null default now(), is_demo boolean not null default false
);
create table bed_stays (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  bed_id int not null references beds,
  reason text,
  admitted_at timestamptz not null default now(), admitted_by uuid references profiles,
  discharged_at timestamptz, discharged_by uuid references profiles, outcome outcome_t,
  is_demo boolean not null default false
);
create unique index one_open_stay_per_bed on bed_stays (bed_id) where discharged_at is null;

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid, action text not null, table_name text not null, record_id uuid,
  old_data jsonb, new_data jsonb, is_demo boolean not null default false
);

-- ---------- triggers ----------
create function inherit_demo() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'visits' then
    new.is_demo := coalesce((select is_demo from patients where id = new.patient_id), false);
  else
    new.is_demo := coalesce((select is_demo from visits where id = new.visit_id), false);
  end if;
  return new;
end $$;

create function check_staff_id() returns trigger language plpgsql as $$
begin
  if new.staff_id is null and (select (value)::text = 'true' from app_settings where key = 'require_staff_id') then
    raise exception 'Staff ID is required';
  end if;
  return new;
end $$;

-- Typed-by vs decided-by. On edit, author never changes, so corrections never rewrite history.
create function set_attribution() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if new.entry_type = 'original' then new.author_id := auth.uid();
    elsif new.author_id is null then raise exception 'Name the clinician who authored this entry';
    end if;
  else
    new.entered_by := old.entered_by;
    new.author_id := old.author_id;
    if new.entry_type = 'confirmed' and old.entry_type <> 'confirmed' then
      if auth.uid() is distinct from old.author_id then
        raise exception 'Only the responsible clinician can confirm this entry';
      end if;
      new.confirmed_by := auth.uid(); new.confirmed_at := now();
    else
      new.entry_type := old.entry_type;
    end if;
  end if;
  return new;
end $$;

create function audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data, is_demo)
  values (auth.uid(), tg_op, tg_table_name, (r->>'id')::uuid,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          coalesce((r->>'is_demo')::boolean, false));
  return coalesce(new, old);
end $$;

create trigger patients_staff_id before insert or update on patients for each row execute function check_staff_id();
create trigger visits_demo before insert on visits for each row execute function inherit_demo();
do $$ declare t text; begin
  foreach t in array array['vitals','visit_notes','prescriptions','referrals','bed_stays'] loop
    execute format('create trigger %I_demo before insert on %I for each row execute function inherit_demo()', t, t);
  end loop;
  foreach t in array array['visit_notes','prescriptions','referrals'] loop
    execute format('create trigger %I_attr before insert or update on %I for each row execute function set_attribution()', t, t);
  end loop;
  foreach t in array array['patients','visits','vitals','visit_notes','prescriptions','referrals','bed_stays','profiles'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit()', t, t);
  end loop;
end $$;

-- ---------- row level security ----------
-- Safety manager has NO policy on clinical tables: no access except weekly_stats().
-- Nobody can delete clinical rows; only clear_demo_data() (admin) removes flagged demo rows.
do $$ declare t text; begin
  foreach t in array array['patients','visits','vitals','visit_notes','prescriptions','referrals','bed_stays'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (is_clinician())', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_clinician())', t, t);
    execute format('create policy %I_update on %I for update using (is_clinician()) with check (is_clinician())', t, t);
  end loop;
  foreach t in array array['profiles','app_settings','departments','beds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (auth_role() is not null)', t, t);
    execute format('create policy %I_admin on %I for all using (auth_is_admin()) with check (auth_is_admin())', t, t);
  end loop;
end $$;
alter table audit_log enable row level security;
create policy audit_admin_read on audit_log for select using (auth_is_admin());
revoke update, delete on audit_log from authenticated, anon;

-- ---------- functions the app calls ----------
create function search_patients(q text) returns setof patients language sql stable as $$
  select * from patients
  where staff_id ilike q || '%'
     or full_name % q
     or full_name ilike '%' || q || '%'
     or (regexp_replace(q, '\D', '', 'g') <> '' and phone like '%' || regexp_replace(q, '\D', '', 'g') || '%')
  order by similarity(full_name, q) desc
  limit 20 $$;

-- Aggregates only: the only data the safety manager can reach.
create function weekly_stats(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if auth_role() is null then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'consultations', count(*),
    'unique_patients', count(distinct v.patient_id),
    'repeat_visits', count(*) filter (where exists (select 1 from visits e where e.patient_id = v.patient_id and e.visit_at < v.visit_at)),
    'referrals', (select count(*) from referrals r join visits x on x.id = r.visit_id where x.visit_at::date between p_from and p_to),
    'bed_admissions', (select count(*) from bed_stays b where b.admitted_at::date between p_from and p_to),
    'avg_rest_minutes', (select round(avg(extract(epoch from (discharged_at - admitted_at)) / 60)) from bed_stays b where b.discharged_at is not null and b.admitted_at::date between p_from and p_to)
  ) into res from visits v where v.visit_at::date between p_from and p_to;
  return res;
end $$;

create function clear_demo_data() returns void language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  delete from patients where is_demo;       -- cascades to visits, vitals, notes, etc.
  delete from audit_log where is_demo;
end $$;

-- ---------- seed (fictional) ----------
insert into departments (name) values ('IT'),('HR'),('Security'),('Customer Care'),('Corporate Finance'),
  ('Treasury'),('Admin & Procurement'),('Facility Management'),('Internal Audit'),('Transport');
insert into beds (name, room) values ('Male 1','Male observation room'),('Male 2','Male observation room'),
  ('Female 1','Female observation room'),('Female 2','Female observation room');

insert into patients (full_name, sex, approx_age, department_id, consent, is_demo) values
  ('Amaka Nwosu (demo)', 'female', 34, 2, 'yes', true),
  ('Tunde Bakare (demo)', 'male', 41, 1, 'yes', true),
  ('Zainab Musa (demo)', 'female', 28, 4, 'no', true);
insert into visits (patient_id, visit_at, plan_accepted)
  select id, now() - interval '2 days', true from patients where is_demo;
-- Visits for the same patient later = repeat visits; the app appends, never overwrites.

-- ---------- create your three users ----------
-- 1) Supabase dashboard > Authentication > Add user (no public signup; disable signups in settings).
-- 2) Then link each profile, e.g.:
--    insert into profiles (id, full_name, role, is_admin) values ('<auth-uuid>', 'Your Name', 'nurse', true);
--    ...'Omotayo Samuel', 'doctor', false  /  ...'Nicholas Okorie', 'safety_manager', false
