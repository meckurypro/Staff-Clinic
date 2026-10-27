-- 005: admin-only bulk import of historical records (from the clinic's Excel sheet)

-- During an import, entries are stored as transcribed history with no named author.
create or replace function set_attribution() returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('app.importing', true) = 'on' then
    if tg_op = 'INSERT' then new.entered_by := auth.uid(); end if;
    return new;
  end if;
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

-- Safe to run twice: patients are matched by name, and a visit at the same moment is skipped.
create function import_clinic_data(payload jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare p jsonb; v jsonb; pid uuid; vid uuid; did int; dname text; t text; seen int;
        n_pat int := 0; n_vis int := 0; n_skip int := 0;
begin
  if not auth_is_admin() then raise exception 'Admin only'; end if;
  perform set_config('app.importing', 'on', true);
  for p in select * from jsonb_array_elements(payload->'patients') loop
    dname := nullif(trim(p->>'department'), ''); did := null;
    if dname is not null then
      select id into did from departments where lower(name) = lower(dname);
      if did is null then insert into departments (name) values (dname) returning id into did; end if;
    end if;
    select id into pid from patients
      where lower(full_name) = lower(trim(p->>'full_name')) and not is_demo and (did is null or department_id is null or department_id = did)
      order by created_at limit 1;
    if pid is null then
      insert into patients (full_name, approx_age, phone, department_id, consent, created_by)
      values (trim(p->>'full_name'), (p->>'age')::smallint, nullif(p->>'phone', ''), did, nullif(p->>'consent', '')::consent_t, auth.uid())
      returning id into pid;
      n_pat := n_pat + 1;
    end if;
    for v in select * from jsonb_array_elements(p->'visits') loop
      select count(*) into seen from visits x where x.patient_id = pid and x.visit_at = (v->>'visit_at')::timestamptz;
      if seen > 0 then n_skip := n_skip + 1; continue; end if;
      insert into visits (patient_id, visit_at, plan_accepted, created_by)
      values (pid, (v->>'visit_at')::timestamptz, (v->>'plan_accepted')::boolean, auth.uid()) returning id into vid;
      if (v->>'bp_s') is not null or (v->>'pulse') is not null or (v->>'temp') is not null or (v->>'weight') is not null or (v->>'rbs') is not null then
        insert into vitals (visit_id, bp_systolic, bp_diastolic, pulse, temp_c, weight_kg, rbs_mgdl, recorded_at, recorded_by)
        values (vid, (v->>'bp_s')::smallint, (v->>'bp_d')::smallint, (v->>'pulse')::smallint, (v->>'temp')::numeric,
                (v->>'weight')::numeric, (v->>'rbs')::numeric, (v->>'visit_at')::timestamptz, auth.uid());
      end if;
      if nullif(v->>'complaint', '') is not null then
        insert into visit_notes (visit_id, kind, body, entry_type) values (vid, 'complaint', v->>'complaint', 'transcribed');
      end if;
      for t in select jsonb_array_elements_text(coalesce(v->'prescriptions', '[]')) loop
        insert into prescriptions (visit_id, drug, entry_type) values (vid, t, 'transcribed');
      end loop;
      for t in select jsonb_array_elements_text(coalesce(v->'referrals', '[]')) loop
        insert into referrals (visit_id, destination, entry_type) values (vid, t, 'transcribed');
      end loop;
      for t in select jsonb_array_elements_text(coalesce(v->'advice', '[]')) loop
        insert into visit_notes (visit_id, kind, body, entry_type) values (vid, 'advice', t, 'transcribed');
      end loop;
      n_vis := n_vis + 1;
    end loop;
  end loop;
  insert into audit_log (user_id, action, table_name, new_data)
  values (auth.uid(), 'IMPORT', 'import', jsonb_build_object('patients', n_pat, 'visits', n_vis, 'skipped', n_skip));
  return jsonb_build_object('patients', n_pat, 'visits', n_vis, 'skipped', n_skip);
end $$;

grant execute on function import_clinic_data(jsonb) to authenticated;
