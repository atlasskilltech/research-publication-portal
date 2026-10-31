-- 0010_harden_admin_set_user_roles — SECURITY FIX for 0004.
--
-- Problem: 0004 only ran `revoke all ... from public`. On Supabase, functions
-- created in the public schema ALSO receive explicit EXECUTE grants for the
-- `anon` and `authenticated` roles (default privileges), which a revoke from
-- PUBLIC does not remove. admin_set_user_roles() is SECURITY DEFINER and
-- trusted the caller-supplied p_actor, so through
--   POST /rest/v1/rpc/admin_set_user_roles
--   * an ANONYMOUS caller (public anon/publishable key only) could make any
--     account a full administrator (is_admin = true), demote non-protected
--     admins, and grant any role;
--   * a signed-in user could grant themselves any role row (EDITOR, reviewer,
--     ADMINISTRATOR); the 0002 trigger only stopped is_admin itself changing.
-- (Reproduced against the real 0001–0004 SQL: scripts/test-admin-roles-sql.mjs)
--
-- Fix (three independent layers):
--   1. EXECUTE revoked from public, anon and authenticated (service_role only).
--   2. The function refuses ANY end-user request — session role or JWT role
--      anon/authenticated — so even a future accidental re-grant cannot be
--      exploited. Only the server (service role) or a direct SQL session gets in.
--   3. p_actor must be an existing administrator (checked under the advisory
--      lock). p_actor is supplied by the trusted server from the verified
--      session (app/api/admin/users/[id]); layer 2 is what stops anyone else
--      supplying it.
--
-- Depends only on 0004 — can (and should) be applied on its own, before
-- 0005–0009. NOT YET APPLIED. Safe to run more than once.
--
-- Apply ONLY this file. Check the selection first (no network):
--   node scripts/supabase-apply-migrations.mjs 0010 --dry-run
-- then:  node scripts/supabase-apply-migrations.mjs 0010
-- (never run that script without the filter — it applies every file).
--
-- Verify after applying. Expected: false | false | true | true |
-- {"search_path=public, pg_temp"} | true | true   (before 0010: true | true | … | false | false)
--   select
--     has_function_privilege('anon',          'public.admin_set_user_roles(uuid,uuid,text[],text[])', 'execute') as anon_can_execute,
--     has_function_privilege('authenticated', 'public.admin_set_user_roles(uuid,uuid,text[],text[])', 'execute') as authenticated_can_execute,
--     has_function_privilege('service_role',  'public.admin_set_user_roles(uuid,uuid,text[],text[])', 'execute') as service_role_can_execute,
--     p.prosecdef as security_definer,
--     p.proconfig as settings,
--     pg_get_functiondef(p.oid) like '%current_setting(''role'', true)%' as blocks_end_user_requests,
--     pg_get_functiondef(p.oid) like '%where id = p_actor and is_admin%' as requires_admin_actor
--   from pg_proc p
--   where p.oid = 'public.admin_set_user_roles(uuid,uuid,text[],text[])'::regprocedure;

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
  -- 0010 layer 2: never serve an end-user request. PostgREST runs every API
  -- request as SET LOCAL ROLE anon|authenticated with the verified JWT in
  -- request.jwt.claims; p_actor from such a caller cannot be trusted.
  -- (Checked before taking the lock so such callers can't hold it.)
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'RPP_FORBIDDEN' using errcode = '42501';
  end if;

  -- Serialize all admin-count-affecting changes (shared with the delete trigger).
  perform pg_advisory_xact_lock(hashtext('rpp_admin_role_change'));

  -- 0010 layer 3: the acting user must currently be an administrator
  -- (checked after the lock, so a concurrent demotion is respected).
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'RPP_FORBIDDEN' using errcode = '42501';
  end if;

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

revoke all on function public.admin_set_user_roles(uuid, uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.admin_set_user_roles(uuid, uuid, text[], text[]) to service_role;
