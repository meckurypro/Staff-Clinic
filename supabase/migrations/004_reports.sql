-- 004: sick bay report support (fields the report needs, saved reports, snapshot function)
alter table visits add column major_concern text, add column remark text;

create table reports (
  id uuid primary key default gen_random_uuid(),
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  include_names boolean not null default true,
  summary text not null default '',
  trend text not null default '',
  recommendations text not null default '',
  conclusion text not null default '',
  stats jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  personnel jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','final')),
  ai_provider text, ai_model text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  finalised_at timestamptz,
  is_demo boolean not null default false
);
create index reports_period on reports (period_to desc);
alter table reports enable row level security;
create policy reports_clinician_read on reports for select using (is_clinician());
create policy reports_manager_read on reports for select using (auth_role() = 'safety_manager' and status = 'final');
create policy reports_insert on reports for insert with check (is_clinician());
create policy reports_update on reports for update using (is_clinician() and status = 'draft') with check (is_clinician());
create policy reports_delete on reports for delete using (is_clinician() and status = 'draft');

create function reports_finalise() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'final' then raise exception 'A final report cannot be changed'; end if;
  if new.status = 'final' then new.finalised_at := now(); end if;
  return new;
end $$;
create trigger reports_lock before update on reports for each row execute function reports_finalise();
create trigger reports_guard_demo before update on reports for each row execute function guard_demo();
create trigger reports_audit after insert or update or delete on reports for each row execute function audit();

-- Everything the report needs for one period. Runs as the caller, so clinician access rules apply.
create function report_snapshot(p_from date, p_to date, p_names boolean default true) returns jsonb
language plpgsql stable set search_path = public as $$
declare out jsonb;
begin
  if not is_clinician() then raise exception 'Not allowed'; end if;
  with v as (
    select vi.*, pa.full_name, (vi.visit_at at time zone 'Africa/Lagos')::date as d
    from visits vi join patients pa on pa.id = vi.patient_id
    where (vi.visit_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ), r as (
    select v.*, row_number() over (order by v.visit_at) as sn,
      (select string_agg(n.body, '; ' order by n.created_at) from visit_notes n where n.visit_id = v.id and n.kind = 'complaint') as reason,
      (select string_agg(n.body, '; ' order by n.created_at) from visit_notes n where n.visit_id = v.id and n.kind = 'diagnosis') as cond,
      exists (select 1 from prescriptions x where x.visit_id = v.id) as rx,
      (select string_agg(coalesce(nullif(f.destination, ''), 'hospital'), ', ') from referrals f where f.visit_id = v.id) as ref,
      exists (select 1 from bed_stays b where b.visit_id = v.id) as rested
    from v
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'sn', sn::text, 'name', case when p_names then full_name else '—' end,
        'date', to_char(d, 'FMDD Mon YYYY'), 'reason', coalesce(reason, ''), 'condition', coalesce(cond, ''),
        'concern', coalesce(major_concern, ''),
        'remark', coalesce(nullif(remark, ''), concat_ws('; ', case when rx then 'Medications prescribed' end,
                  case when ref is not null then 'Referred to ' || ref end, case when rested then 'Bed rest' end))
      ) order by sn) from r), '[]'::jsonb),
    'stats', jsonb_build_object(
      'consultations', (select count(*) from v),
      'unique_patients', (select count(distinct patient_id) from v),
      'repeat_visits', (select count(*) from v where exists (select 1 from visits e where e.patient_id = v.patient_id and e.visit_at < v.visit_at)),
      'staff_with_multiple_visits', (select count(*) from (select patient_id from v group by patient_id having count(*) > 1) t),
      'major_concerns', (select count(*) from v where nullif(major_concern, '') is not null),
      'referrals', (select count(*) from v where exists (select 1 from referrals f where f.visit_id = v.id)),
      'bed_rest', (select count(*) from v where exists (select 1 from bed_stays b where b.visit_id = v.id)),
      'days_covered', p_to - p_from + 1,
      'busiest_day', (select jsonb_build_object('date', to_char(d, 'FMDD Mon'), 'count', c) from (select d, count(*) c from v group by d order by c desc, d limit 1) t),
      'top_conditions', coalesce((select jsonb_agg(jsonb_build_object('condition', cnd, 'count', c) order by c desc, cnd)
          from (select initcap(lower(trim(n.body))) cnd, count(*) c from visit_notes n join v on v.id = n.visit_id
                where n.kind = 'diagnosis' group by 1 order by c desc, cnd limit 8) t), '[]'::jsonb)),
    'personnel', coalesce((select jsonb_agg(jsonb_build_object('sn', rn::text, 'name', full_name,
          'designation', case role when 'doctor' then 'Medical Doctor' else 'Nurse' end) order by rn)
        from (select full_name, role, row_number() over (order by (role = 'doctor') desc, created_at) rn
              from profiles where is_active and role in ('doctor', 'nurse')) t), '[]'::jsonb),
    'has_demo', coalesce((select bool_or(is_demo) from v), false)
  ) into out;
  return out;
end $$;

create or replace function clear_demo_data() returns void language plpgsql security definer set search_path = public as $$
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  delete from reports where is_demo;
  delete from patients where is_demo;
  delete from audit_log where is_demo;
end $$;

grant execute on function report_snapshot(date, date, boolean) to authenticated;
