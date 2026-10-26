-- 002: invite-based onboarding, hardening, AI settings (keys in Supabase Vault)

-- ---------- onboarding ----------
alter table profiles add column email text;
create unique index profiles_email_key on profiles (lower(email));

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  role user_role not null,
  is_admin boolean not null default false,
  claimed_by uuid references profiles on delete set null,
  claimed_at timestamptz,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  constraint email_normalised check (email = lower(trim(email)))
);
create function norm_email() returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end $$;
create trigger staff_invites_norm before insert or update on staff_invites for each row execute function norm_email();
create trigger staff_invites_audit after insert or update or delete on staff_invites for each row execute function audit();
alter table staff_invites enable row level security;
create policy staff_invites_admin on staff_invites for all using (auth_is_admin()) with check (auth_is_admin());

-- When an invited email signs up (and confirms), link it to a profile with the name and role set by the admin.
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare inv staff_invites%rowtype;
begin
  select * into inv from staff_invites where email = lower(trim(new.email)) and claimed_at is null for update;
  if not found then return new; end if;
  insert into profiles (id, full_name, role, is_admin, email) values (new.id, inv.full_name, inv.role, inv.is_admin, lower(new.email));
  update staff_invites set claimed_by = new.id, claimed_at = now() where id = inv.id;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Optional Auth Hook (enable in Dashboard > Authentication > Hooks): refuse sign-ups from uninvited emails.
create function hook_restrict_signup(event jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from staff_invites where email = lower(trim(event->'user'->>'email')) and claimed_at is null) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('message', 'This email has not been invited. Ask the clinic admin to add it.', 'http_code', 403));
end $$;

insert into staff_invites (email, full_name, role, is_admin)
values ('meckurypro@gmail.com', 'Madu Ezeamaka Chukwuemeka Kingsley', 'nurse', true);

-- ---------- hardening ----------
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select
  using ((id = (select auth.uid()) and is_active) or is_clinician() or auth_is_admin());

create function keep_one_admin() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (old.is_admin and old.is_active and (not new.is_admin or not new.is_active)) then
    if not exists (select 1 from profiles where is_admin and is_active and id <> old.id) then
      raise exception 'At least one active admin is required';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_keep_admin before update or delete on profiles for each row execute function keep_one_admin();

-- Clients can never mark real records as demo, or flip the flag later.
create function guard_demo() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.is_demo := old.is_demo;
  elsif tg_table_name = 'patients' and auth.uid() is not null then new.is_demo := false;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['patients','visits','vitals','visit_notes','prescriptions','referrals','bed_stays'] loop
    execute format('create trigger %I_guard_demo before insert or update on %I for each row execute function guard_demo()', t, t);
  end loop;
  foreach t in array array['vitals','visit_notes','prescriptions','referrals','bed_stays'] loop
    execute format('create index %I_visit_idx on %I (visit_id)', t, t);
  end loop;
end $$;
create index audit_log_record on audit_log (table_name, record_id);
create index audit_log_at on audit_log (at desc);
create index patients_department on patients (department_id);

-- Doctor entries by the nurse (and nursing entries by the doctor) must be recorded on behalf of the other clinician.
create or replace function set_attribution() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if new.entry_type = 'original' then
      if auth.uid() is not null and (
           (auth_role() = 'nurse' and (tg_table_name = 'prescriptions' or to_jsonb(new)->>'kind' in ('medical','diagnosis')))
        or (auth_role() = 'doctor' and to_jsonb(new)->>'kind' = 'nursing')) then
        raise exception 'This section belongs to the other clinician: record it on their behalf';
      end if;
      new.author_id := auth.uid();
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

alter table bed_stays add constraint stay_order check (discharged_at is null or discharged_at >= admitted_at);
alter table vitals
  add constraint v_bp_s check (bp_systolic between 40 and 300), add constraint v_bp_d check (bp_diastolic between 20 and 200),
  add constraint v_pulse check (pulse between 20 and 250), add constraint v_temp check (temp_c between 30 and 45),
  add constraint v_weight check (weight_kg between 1 and 400), add constraint v_rbs check (rbs_mgdl between 10 and 1000);

-- Clinic time is Africa/Lagos, not UTC.
create or replace function weekly_stats(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if auth_role() is null then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'consultations', count(*),
    'unique_patients', count(distinct v.patient_id),
    'repeat_visits', count(*) filter (where exists (select 1 from visits e where e.patient_id = v.patient_id and e.visit_at < v.visit_at)),
    'referrals', (select count(*) from referrals r join visits x on x.id = r.visit_id where (x.visit_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'bed_admissions', (select count(*) from bed_stays b where (b.admitted_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'avg_rest_minutes', (select round(avg(extract(epoch from (discharged_at - admitted_at)) / 60)) from bed_stays b where b.discharged_at is not null and (b.admitted_at at time zone 'Africa/Lagos')::date between p_from and p_to)
  ) into res from visits v where (v.visit_at at time zone 'Africa/Lagos')::date between p_from and p_to;
  return res;
end $$;

-- ---------- AI settings ----------
create table ai_models (
  provider text not null check (provider in ('anthropic','openai','gemini')),
  model_id text not null,
  label text not null,
  tier text not null check (tier in ('flagship','balanced','fast')),
  sort smallint not null,
  note text,
  active boolean not null default true,
  verified_on date not null,
  primary key (provider, model_id)
);
create table ai_settings (
  id boolean primary key default true check (id),
  provider text not null, model_id text not null,
  updated_by uuid references profiles on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (provider, model_id) references ai_models
);
alter table ai_models enable row level security;
alter table ai_settings enable row level security;
create policy ai_models_read on ai_models for select using (auth_role() is not null);
create policy ai_models_admin on ai_models for all using (auth_is_admin()) with check (auth_is_admin());
create policy ai_settings_read on ai_settings for select using (auth_role() is not null);
create policy ai_settings_admin on ai_settings for update using (auth_is_admin()) with check (auth_is_admin());
create trigger ai_settings_audit after update on ai_settings for each row execute function audit();

-- Catalogue checked against each provider's docs on 2026-10-26. Retired or deprecated models are left out.
insert into ai_models (provider, model_id, label, tier, sort, note, verified_on) values
 ('anthropic','claude-opus-5-5','Claude Opus 5.5','flagship',1,'Most capable of the three; slower and dearer','2026-10-26'),
 ('anthropic','claude-sonnet-5-5','Claude Sonnet 5.5','balanced',2,'Best balance for report writing','2026-10-26'),
 ('anthropic','claude-haiku-5-5','Claude Haiku 5.5','fast',3,'Fastest and cheapest','2026-10-26'),
 ('openai','gpt-6-astra','GPT-6 Astra','flagship',1,'OpenAI flagship; highest cost','2026-10-26'),
 ('openai','gpt-6.1-sol','GPT-6.1 Sol','balanced',2,'Near-flagship quality at a fifth of the price','2026-10-26'),
 ('openai','gpt-6-luna','GPT-6 Luna','fast',3,'Cheapest; fine for summaries','2026-10-26'),
 ('gemini','gemini-4-argon','Gemini 4 Argon','flagship',1,'Most capable Gemini; no free tier','2026-10-26'),
 ('gemini','gemini-3.8-flash','Gemini 3.8 Flash','balanced',2,'Current Flash model; good everyday choice','2026-10-26'),
 ('gemini','gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite','fast',3,'Lightest and cheapest','2026-10-26');
insert into ai_settings (provider, model_id) values ('gemini','gemini-3.8-flash');

-- API keys live in Supabase Vault. They can be written by an admin, never read back by the browser.
create function admin_set_ai_key(p_provider text, p_key text) returns void language plpgsql security definer set search_path = public as $$
declare nm text := 'ai_key_' || p_provider; sid uuid;
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  if p_provider not in ('anthropic','openai','gemini') then raise exception 'Unknown provider'; end if;
  if length(trim(p_key)) < 20 then raise exception 'That does not look like an API key'; end if;
  select id into sid from vault.secrets where name = nm;
  if sid is null then perform vault.create_secret(trim(p_key), nm, 'AI provider key');
  else perform vault.update_secret(sid, trim(p_key)); end if;
  insert into audit_log (user_id, action, table_name, new_data) values (auth.uid(), 'SET_AI_KEY', 'ai_keys', jsonb_build_object('provider', p_provider));
end $$;
create function admin_delete_ai_key(p_provider text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  delete from vault.secrets where name = 'ai_key_' || p_provider;
  insert into audit_log (user_id, action, table_name, new_data) values (auth.uid(), 'DELETE_AI_KEY', 'ai_keys', jsonb_build_object('provider', p_provider));
end $$;
create function admin_ai_key_status() returns table (provider text, has_key boolean) language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  return query select p, exists (select 1 from vault.secrets s where s.name = 'ai_key_' || p) from unnest(array['anthropic','openai','gemini']) p;
end $$;
create function get_ai_key(p_provider text) returns text language sql security definer set search_path = public as
$$ select decrypted_secret from vault.decrypted_secrets where name = 'ai_key_' || p_provider $$;

-- ---------- privileges ----------
revoke all on all tables in schema public from anon;
revoke insert, truncate on audit_log from authenticated;
alter default privileges in schema public revoke all on tables from anon;
revoke execute on function auth_role(), auth_is_admin(), is_clinician(), search_patients(text), weekly_stats(date, date),
  clear_demo_data(), handle_new_user(), hook_restrict_signup(jsonb), set_attribution(), audit(), inherit_demo(), check_staff_id(),
  keep_one_admin(), guard_demo(), norm_email(), admin_set_ai_key(text, text), admin_delete_ai_key(text), admin_ai_key_status(),
  get_ai_key(text) from public, anon;
grant execute on function auth_role(), auth_is_admin(), is_clinician(), search_patients(text), weekly_stats(date, date),
  clear_demo_data(), admin_set_ai_key(text, text), admin_delete_ai_key(text), admin_ai_key_status() to authenticated;
grant execute on function get_ai_key(text) to service_role;
grant execute on function hook_restrict_signup(jsonb) to supabase_auth_admin;
