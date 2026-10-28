-- 006: integration secrets (Vault), report email log, settings for email and the Google Sheet mirror

create function admin_set_secret(p_name text, p_value text) returns void language plpgsql security definer set search_path = public as $$
declare nm text := 'int_' || p_name; sid uuid;
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  if p_name not in ('resend_api_key', 'google_service_account') then raise exception 'Unknown secret'; end if;
  if length(trim(p_value)) < 20 then raise exception 'That value looks too short'; end if;
  select id into sid from vault.secrets where name = nm;
  if sid is null then perform vault.create_secret(trim(p_value), nm, 'Integration secret');
  else perform vault.update_secret(sid, trim(p_value)); end if;
  insert into audit_log (user_id, action, table_name, new_data) values (auth.uid(), 'SET_SECRET', 'secrets', jsonb_build_object('name', p_name));
end $$;
create function admin_delete_secret(p_name text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  delete from vault.secrets where name = 'int_' || p_name;
  insert into audit_log (user_id, action, table_name, new_data) values (auth.uid(), 'DELETE_SECRET', 'secrets', jsonb_build_object('name', p_name));
end $$;
create function admin_secret_status() returns table (name text, has_value boolean) language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  return query select n, exists (select 1 from vault.secrets s where s.name = 'int_' || n) from unnest(array['resend_api_key', 'google_service_account']) n;
end $$;
create function get_secret(p_name text) returns text language sql security definer set search_path = public as
$$ select decrypted_secret from vault.decrypted_secrets where name = 'int_' || p_name $$;

create table report_emails (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports on delete cascade,
  sent_by uuid references profiles on delete set null,
  to_addrs text[] not null,
  subject text,
  status text not null check (status in ('sent', 'failed')),
  detail text,
  sent_at timestamptz not null default now()
);
create index report_emails_report on report_emails (report_id);
alter table report_emails enable row level security;
create policy report_emails_read on report_emails for select using (is_clinician() or auth_is_admin());

insert into app_settings (key, value) values
  ('report_email', '{"from": "", "recipients": []}'::jsonb),
  ('sheets', '{"spreadsheet_id": "", "include_names": true}'::jsonb),
  ('sheets_status', '{}'::jsonb);

grant execute on function admin_set_secret(text, text), admin_delete_secret(text), admin_secret_status() to authenticated;
grant execute on function get_secret(text) to service_role;
