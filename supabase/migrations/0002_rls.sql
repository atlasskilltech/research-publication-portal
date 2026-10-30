-- 0002_rls — Row Level Security for public.profiles.
--
-- Access model:
--   * A signed-in user may read and update ONLY their own profile.
--   * An Administrator may read (and update) every profile.
--   * No one may INSERT or DELETE profiles through the API — inserts happen via
--     the handle_new_user() trigger, deletes cascade from auth.users.
--   * A normal user can never change their own is_admin or base_type, so they
--     cannot escalate their privileges. Only the service role (the provisioning
--     script) or a direct SQL session may change those.
--
-- Safe to run more than once.

alter table public.profiles enable row level security;

-- Admin test used inside the policies. SECURITY DEFINER so it reads the caller's
-- own row without being subject to (and recursing through) the SELECT policy
-- below.
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- SELECT: own row, or any row for an admin.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or public.current_user_is_admin());

-- UPDATE: own row, or any row for an admin. Column-level immutability of the
-- privilege fields is enforced by the trigger below, not here (RLS WITH CHECK
-- cannot see the previous row).
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = auth.uid() or public.current_user_is_admin())
  with check (id = auth.uid() or public.current_user_is_admin());

-- Block privilege escalation: a request coming in as the `authenticated` role
-- (i.e. an ordinary signed-in user, including an admin editing their own row
-- through the app) cannot change is_admin or base_type. Requests made with the
-- service-role key, or run directly in SQL (where auth.role() is null), are
-- unaffected, so deliberate admin provisioning still works.
create or replace function public.profiles_prevent_escalation()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.is_admin  := old.is_admin;
    new.base_type := old.base_type;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_escalation on public.profiles;
create trigger profiles_prevent_escalation
  before update on public.profiles
  for each row execute function public.profiles_prevent_escalation();
