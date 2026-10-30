-- 010: every saved visit is queued, then appended to the doctor's Google Sheet as one new row.

create table sheet_outbox (
  id bigserial primary key,
  visit_id uuid not null unique references visits on delete cascade,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
alter table sheet_outbox enable row level security;
revoke all on sheet_outbox from anon, authenticated;

-- Fires when the transaction commits, so the visit's notes, vitals and prescriptions already exist.
create function enqueue_sheet_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.importing', true) = 'on' then return null; end if;       -- bulk imports are sent by "Rebuild sheet"
  if exists (select 1 from visits where id = new.id and not is_demo)
     and coalesce((select value->>'spreadsheet_id' from app_settings where key = 'sheets'), '') <> '' then
    insert into sheet_outbox (visit_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end $$;
create constraint trigger visits_enqueue_sheet after insert on visits deferrable initially deferred for each row execute function enqueue_sheet_row();

-- A worker takes a batch; a stale claim (crashed worker) becomes available again after two minutes.
create function claim_sheet_outbox(p_limit int default 50) returns table (id bigint, visit_id uuid) language sql security definer set search_path = public as $$
  update sheet_outbox o set claimed_at = now(), attempts = o.attempts + 1
  where o.id in (select x.id from sheet_outbox x where x.sent_at is null and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
                 order by x.id limit p_limit for update skip locked)
  returning o.id, o.visit_id $$;
create function finish_sheet_outbox(p_ids bigint[], p_error text default null) returns void language sql security definer set search_path = public as $$
  update sheet_outbox set sent_at = case when p_error is null then now() end, claimed_at = null, last_error = left(p_error, 300) where id = any(p_ids) $$;
create function clear_sheet_outbox() returns void language sql security definer set search_path = public as $$
  update sheet_outbox set sent_at = now(), claimed_at = null, last_error = null where sent_at is null $$;

create function sheet_outbox_status() returns table (pending bigint, last_error text, last_sent timestamptz) language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_clinician() or auth_is_admin()) then raise exception 'Not allowed'; end if;
  return query select (select count(*) from sheet_outbox where sent_at is null),
                      (select o.last_error from sheet_outbox o where o.sent_at is null and o.last_error is not null order by o.id desc limit 1),
                      (select max(sent_at) from sheet_outbox);
end $$;

revoke execute on function enqueue_sheet_row(), claim_sheet_outbox(int), finish_sheet_outbox(bigint[], text), clear_sheet_outbox(), sheet_outbox_status() from public, anon, authenticated;
grant execute on function claim_sheet_outbox(int), finish_sheet_outbox(bigint[], text), clear_sheet_outbox() to service_role;
grant execute on function sheet_outbox_status() to authenticated;
