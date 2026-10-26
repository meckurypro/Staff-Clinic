-- Supabase grants EXECUTE on new functions to authenticated by default. Internal functions must not be callable from the API.
revoke execute on function get_ai_key(text), audit(), handle_new_user(), hook_restrict_signup(jsonb), set_attribution(),
  inherit_demo(), check_staff_id(), keep_one_admin(), guard_demo(), norm_email() from authenticated, anon, public;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

alter function is_clinician() set search_path = public;
alter function search_patients(text) set search_path = public;
alter function norm_email() set search_path = public;
alter function set_attribution() set search_path = public;
alter function inherit_demo() set search_path = public;
alter function check_staff_id() set search_path = public;
alter function keep_one_admin() set search_path = public;
alter function guard_demo() set search_path = public;
