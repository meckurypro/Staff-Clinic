-- Functions created by later migrations got Supabase's default EXECUTE grants. Keep secrets reachable only by the server.
revoke execute on function get_secret(text) from public, anon, authenticated;
grant execute on function get_secret(text) to service_role;
revoke execute on function admin_set_secret(text, text), admin_delete_secret(text), admin_secret_status(),
  report_snapshot(date, date, boolean), import_clinic_data(jsonb) from public, anon;
grant execute on function admin_set_secret(text, text), admin_delete_secret(text), admin_secret_status(),
  report_snapshot(date, date, boolean), import_clinic_data(jsonb) to authenticated;
