-- GoTrue's admin createUser inserts the auth user first and writes app_metadata
-- in a follow-up update, so the insert trigger never saw lab_id/role.
-- Also react to app_metadata updates. Only fills a missing lab (never moves a
-- user between labs). app_metadata is writable only by the service role.
create or replace function public.link_profile_from_app_meta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_app_meta_data ? 'lab_id'
     and new.raw_app_meta_data is distinct from old.raw_app_meta_data then
    update public.profiles
       set lab_id = (new.raw_app_meta_data->>'lab_id')::uuid,
           role   = coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'staff')
     where id = new.id and lab_id is null;
  end if;
  return new;
end $$;

revoke execute on function public.link_profile_from_app_meta() from public, anon, authenticated;

create trigger on_auth_user_app_meta_updated
  after update of raw_app_meta_data on auth.users
  for each row execute function public.link_profile_from_app_meta();

-- Repair accounts created before this fix
update public.profiles p
   set lab_id = (u.raw_app_meta_data->>'lab_id')::uuid,
       role   = coalesce((u.raw_app_meta_data->>'role')::public.app_role, 'staff')
  from auth.users u
 where u.id = p.id and p.lab_id is null and u.raw_app_meta_data ? 'lab_id';
