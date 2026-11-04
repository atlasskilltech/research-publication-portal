-- 0004_user_roles — normalized ADDITIONAL-role assignment, with atomic +
-- race-safe administrator synchronization.
--
-- Student/Faculty identity stays in profiles.base_type (not stored here). This
-- table holds only the extra roles an administrator may grant.
--
-- Separation of concerns:
--   * profiles.base_type → Student / Faculty (source of truth, unchanged).
--   * profiles.is_admin  → SOLE source of truth for admin AUTHORIZATION. The
--     'ADMINISTRATOR' row here MIRRORS it; the RPC below changes BOTH atomically.
--   * SPOC / DESK_REVIEWER / PEER_REVIEWER / EDITOR are stored + displayed only;
--     no new server-side enforcement is added.
--
-- The signup trigger (handle_new_user, 0003) is left as-is: a new account gets
-- its base type and NO additional roles.
--
-- Safe to run more than once.

create table if not exists public.user_roles (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  role        text        not null
                check (role in ('ADMINISTRATOR','SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR')),
  assigned_by uuid        references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_idx    on public.user_roles (role);

-- ---- Row Level Security: read own/admin; writes only via service role -------
alter table public.user_roles enable row level security;
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select
  using (user_id = auth.uid() or public.current_user_is_admin());

-- ---- Atomic, race-safe role reconciliation + is_admin sync -----------------
-- Sets a user's FULL set of additional roles and keeps profiles.is_admin in
-- lockstep with the ADMINISTRATOR role — all in ONE transaction, so both change
-- or neither does (no is_admin=true-without-ADMINISTRATOR, or vice versa).
--
-- Race safety: a transaction-scoped advisory lock serializes every admin-count-
-- affecting change (this RPC and the last-admin delete trigger share the key),
-- so concurrent promotions/revocations/deletes cannot slip past the last-admin
-- check. Guards (self / protected original admins / last administrator) are
-- enforced HERE on the server, not merely in the UI.
--
-- Raises (mapped to HTTP by the API): RPP_INVALID_ROLE, RPP_NOT_FOUND,
-- RPP_SELF, RPP_PROTECTED, RPP_LAST_ADMIN.
create or replace function public.admin_set_user_roles(
  p_actor     uuid,
  p_target    uuid,
  p_roles     text[],
  p_protected text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed   text[] := array['ADMINISTRATOR','SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR'];
  v_roles     text[] := coalesce(p_roles, array[]::text[]);
  v_email     text;
  v_curr      boolean;
  v_next      boolean;
  v_others    int;
  v_role      text;
begin
  -- Serialize all admin-count-affecting changes (shared with the delete trigger).
  perform pg_advisory_xact_lock(hashtext('rpp_admin_role_change'));

  foreach v_role in array v_roles loop
    if not (v_role = any(v_allowed)) then
      raise exception 'RPP_INVALID_ROLE:%', v_role using errcode = '22023';
    end if;
  end loop;

  -- Lock the target profile row for the duration of the transaction.
  select email, is_admin into v_email, v_curr
    from public.profiles where id = p_target for update;
  if not found then
    raise exception 'RPP_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_next := ('ADMINISTRATOR' = any(v_roles));

  -- No one may change their OWN roles (covers self-promotion/revocation).
  if p_actor = p_target then
    raise exception 'RPP_SELF' using errcode = '42501';
  end if;

  -- Protected original admins may not be demoted.
  if v_curr and not v_next
     and lower(v_email) = any (select lower(x) from unnest(coalesce(p_protected, array[]::text[])) x) then
    raise exception 'RPP_PROTECTED' using errcode = '42501';
  end if;

  -- Never remove the last administrator.
  if v_curr and not v_next then
    select count(*) into v_others from public.profiles where is_admin = true and id <> p_target;
    if v_others = 0 then
      raise exception 'RPP_LAST_ADMIN' using errcode = '23514';
    end if;
  end if;

  -- Reconcile: delete roles no longer requested, add the new ones.
  delete from public.user_roles
    where user_id = p_target and not (role = any (v_roles));
  insert into public.user_roles (user_id, role, assigned_by)
    select p_target, r, p_actor from unnest(v_roles) r
    on conflict (user_id, role) do nothing;

  -- Keep is_admin in lockstep (same transaction).
  if v_curr is distinct from v_next then
    update public.profiles set is_admin = v_next where id = p_target;
  end if;

  return jsonb_build_object(
    'is_admin', v_next,
    'roles', (select coalesce(jsonb_agg(role order by role), '[]'::jsonb)
                from public.user_roles where user_id = p_target)
  );
end;
$$;

-- Only the service role (the admin API) may invoke it.
revoke all on function public.admin_set_user_roles(uuid, uuid, text[], text[]) from public;
grant execute on function public.admin_set_user_roles(uuid, uuid, text[], text[]) to service_role;

-- ---- Race-safe last-admin protection on DELETE -----------------------------
-- Deleting a user cascades from auth.users → profiles. This BEFORE DELETE
-- trigger (under the same advisory lock) refuses to remove the final
-- administrator, so even a direct/concurrent delete can never empty the admin
-- set. Protected-admin and self-delete remain enforced in the API.
create or replace function public.prevent_last_admin_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_admin then
    perform pg_advisory_xact_lock(hashtext('rpp_admin_role_change'));
    if (select count(*) from public.profiles where is_admin = true and id <> old.id) = 0 then
      raise exception 'RPP_LAST_ADMIN' using errcode = '23514';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_prevent_last_admin_delete on public.profiles;
create trigger profiles_prevent_last_admin_delete
  before delete on public.profiles
  for each row execute function public.prevent_last_admin_delete();

-- ---- One-time backfill: existing admins → ADMINISTRATOR --------------------
insert into public.user_roles (user_id, role)
  select id, 'ADMINISTRATOR' from public.profiles where is_admin = true
  on conflict (user_id, role) do nothing;
