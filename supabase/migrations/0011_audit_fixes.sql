-- 0011_audit_fixes — fixes found in the final completion audit.
--
-- Depends on 0005–0009 (apply together with them, after 0010).
-- NOT YET APPLIED. Safe to run more than once.
--
-- 1. Decision immutability vs. account deletion.
--    editorial_decisions.decided_by / released_by are ON DELETE SET NULL. That
--    SET NULL is an UPDATE, which the 0008 immutability trigger refused for any
--    released decision (RPP:DECISION_FINAL) — so deleting an editor who had
--    ever communicated a decision failed (admin "Delete user" → 500).
--    A cascade DELETE from papers was blocked the same way.
--    The trigger now also allows:
--      * an UPDATE that only clears decided_by / released_by (account deleted),
--        with every other column unchanged;
--      * a DELETE that comes from the parent paper being deleted.
--    Every other change to a communicated decision is still refused.
--
-- 2. Authors are told when their paper is published.
--    PAPER_PUBLISHED is added to the owner-visible activity allowlist (kept in
--    sync with OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js; the policy is
--    otherwise identical to 0008).

-- ---- 1. Decision immutability ------------------------------------------------
create or replace function public._rpp_decision_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.released_at is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Cascade from the parent paper: the paper row is already gone.
    if not exists (select 1 from public.papers where id = old.paper_id) then
      return old;
    end if;
    raise exception 'RPP:DECISION_FINAL';
  end if;

  -- UPDATE during a paper delete cascade (e.g. revision_id SET NULL as the
  -- paper's revisions are removed): the decision row is about to go too.
  if not exists (select 1 from public.papers where id = old.paper_id) then
    return new;
  end if;

  -- Otherwise only the ON DELETE SET NULL of the decider/releaser is allowed.
  if (new.decided_by is null or new.decided_by is not distinct from old.decided_by)
     and (new.released_by is null or new.released_by is not distinct from old.released_by)
     and (new.decided_by is distinct from old.decided_by or new.released_by is distinct from old.released_by)
     and new.paper_id          is not distinct from old.paper_id
     and new.round             is not distinct from old.round
     and new.decision          is not distinct from old.decision
     and new.summary           is not distinct from old.summary
     and new.confidential_note is not distinct from old.confidential_note
     and new.review_ids        is not distinct from old.review_ids
     and new.revision_due_at   is not distinct from old.revision_due_at
     and new.revision_id       is not distinct from old.revision_id
     and new.version           is not distinct from old.version
     and new.released_at       is not distinct from old.released_at
  then
    return new;
  end if;
  raise exception 'RPP:DECISION_FINAL';
end $$;
revoke all on function public._rpp_decision_immutable() from public, anon, authenticated;

-- ---- 2. Owner-visible activity --------------------------------------------------
-- Keep in sync with OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js.
drop policy if exists paper_activity_select on public.paper_activity;
create policy paper_activity_select on public.paper_activity for select using (
  public.current_user_is_admin()
  or (
    action in ('SUBMITTED','REVISION_REQUESTED','REVISION_STARTED','REVISION_MANUSCRIPT_UPLOADED','REVISION_RESPONSE_SAVED','REVISION_SUBMITTED','REREVIEW_ASSIGNED','DECISION_COMMUNICATED','PAPER_ACCEPTED','PAPER_REJECTED','PAPER_PUBLISHED')
    and exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  )
);
