-- 0008_editorial_decisions — editorial decisions (Phase 4).
--
-- Requires 0005, 0006, 0007.
--
-- One decision per (paper, review round). A decision is first SAVED (a draft
-- the paper's managers can still edit) and then COMMUNICATED (released to the
-- author). Releasing applies its effect in the same transaction:
--   ACCEPT          → papers.status = ACCEPTED   (eligible for publication later)
--   REJECT          → papers.status = REJECTED   (no further revisions: every
--                                                 revision path requires UNDER_REVIEW)
--   MINOR_REVISION  → request_paper_revision(... 'MINOR' ...)  (Phase 3, reused)
--   MAJOR_REVISION  → request_paper_revision(... 'MAJOR' ...)  (Phase 3, reused)
-- A released decision is immutable (trigger) — history is never overwritten.
--
-- Reuses papers.status (no new status system), paper_revisions (no duplicate
-- revision records) and _rpp_is_manager (admin or the paper's EDITOR).
-- A reviewer's recommendation never becomes a decision: only these functions,
-- called by a manager, create one.
--
-- NOT YET APPLIED (shared prod project). Apply to staging with 0005–0007.
-- Safe to run more than once.

create table if not exists public.editorial_decisions (
  id                uuid        primary key default gen_random_uuid(),
  paper_id          uuid        not null references public.papers (id) on delete cascade,
  round             int         not null check (round >= 0),   -- review round decided on
  decision          text        not null check (decision in ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT')),
  -- Author-facing message (decision letter; for revisions also the revision
  -- instructions passed to paper_revisions.instructions).
  summary           text        not null check (char_length(summary) between 1 and 10000),
  -- Editor/admin only. Never returned to authors (no author RLS on this table).
  confidential_note text        check (char_length(confidential_note) <= 10000),
  -- Submitted reviews released to the author with this decision.
  review_ids        uuid[]      not null default '{}',
  revision_due_at   timestamptz,
  revision_id       uuid        references public.paper_revisions (id) on delete set null,
  version           int         not null default 1,           -- optimistic concurrency
  decided_by        uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  released_at       timestamptz,                              -- communicated to author
  released_by       uuid        references auth.users (id) on delete set null,
  unique (paper_id, round)                                     -- no duplicate decisions per round
);
create index if not exists editorial_decisions_paper_idx on public.editorial_decisions (paper_id);
create index if not exists editorial_decisions_released_idx on public.editorial_decisions (released_at);

drop trigger if exists editorial_decisions_set_updated_at on public.editorial_decisions;
create trigger editorial_decisions_set_updated_at
  before update on public.editorial_decisions
  for each row execute function public.set_updated_at();

-- History preservation: a communicated decision can never be edited or deleted.
create or replace function public._rpp_decision_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.released_at is not null then
    raise exception 'RPP:DECISION_FINAL';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists editorial_decisions_immutable on public.editorial_decisions;
create trigger editorial_decisions_immutable
  before update or delete on public.editorial_decisions
  for each row execute function public._rpp_decision_immutable();

-- ---- RLS -------------------------------------------------------------------
-- Admins and the paper's editor only. Authors read their RELEASED decisions
-- through the API, which strips confidential_note and reviewer identity —
-- row-level policies can't hide a column, so authors get no direct access.
alter table public.editorial_decisions enable row level security;
drop policy if exists editorial_decisions_select on public.editorial_decisions;
create policy editorial_decisions_select on public.editorial_decisions for select using (
  public.current_user_is_admin() or public.current_user_is_paper_editor(paper_id)
);

-- Activity: authors additionally see that a decision was communicated and the
-- accept/reject outcome. Draft events (DECISION_CREATED/UPDATED) stay hidden.
-- Keep in sync with OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js.
drop policy if exists paper_activity_select on public.paper_activity;
create policy paper_activity_select on public.paper_activity for select using (
  public.current_user_is_admin()
  or (
    action in ('SUBMITTED','REVISION_REQUESTED','REVISION_STARTED','REVISION_MANUSCRIPT_UPLOADED','REVISION_RESPONSE_SAVED','REVISION_SUBMITTED','REREVIEW_ASSIGNED','DECISION_COMMUNICATED','PAPER_ACCEPTED','PAPER_REJECTED')
    and exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  )
);

-- ---- Transactional functions (service role only) ---------------------------

-- Create or update the current round's UNRELEASED decision.
create or replace function public.save_editorial_decision(
  p_paper uuid, p_actor uuid, p_decision text, p_summary text, p_note text,
  p_review_ids uuid[], p_due timestamptz
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_paper public.papers%rowtype;
  v_dec public.editorial_decisions%rowtype;
  v_wanted int;
  v_valid int;
  v_ids uuid[];
begin
  select * into v_paper from public.papers where id = p_paper for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(p_paper, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_paper.status <> 'UNDER_REVIEW' then raise exception 'RPP:NOT_UNDER_REVIEW'; end if;
  if p_decision not in ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT') then raise exception 'RPP:BAD_DECISION'; end if;
  if coalesce(char_length(trim(p_summary)), 0) = 0 then raise exception 'RPP:NO_SUMMARY'; end if;
  if exists (select 1 from public.paper_revisions where paper_id = p_paper
             and status in ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED')) then
    raise exception 'RPP:OPEN_REVISION';
  end if;
  -- Decide only after reviewing: at least one SUBMITTED review this round.
  if not exists (select 1 from public.reviews where paper_id = p_paper
                 and round = v_paper.current_round and status = 'SUBMITTED') then
    raise exception 'RPP:NO_SUBMITTED_REVIEWS';
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_review_ids, '{}')) as x);
  v_wanted := coalesce(array_length(v_ids, 1), 0);
  if p_decision in ('MINOR_REVISION','MAJOR_REVISION') and v_wanted = 0 then raise exception 'RPP:NO_REVIEWS'; end if;
  if v_wanted > 0 then
    select count(*) into v_valid from public.reviews
     where id = any(v_ids) and paper_id = p_paper and round = v_paper.current_round and status = 'SUBMITTED';
    if v_valid <> v_wanted then raise exception 'RPP:BAD_REVIEWS'; end if;
  end if;

  select * into v_dec from public.editorial_decisions
   where paper_id = p_paper and round = v_paper.current_round for update;

  if found then
    if v_dec.released_at is not null then raise exception 'RPP:DECISION_EXISTS'; end if;
    update public.editorial_decisions
       set decision = p_decision, summary = trim(p_summary), confidential_note = nullif(trim(coalesce(p_note, '')), ''),
           review_ids = v_ids,
           revision_due_at = case when p_decision in ('MINOR_REVISION','MAJOR_REVISION') then p_due end,
           decided_by = p_actor, version = version + 1
     where id = v_dec.id
     returning * into v_dec;
    insert into public.paper_activity (paper_id, actor, action, detail)
    values (p_paper, p_actor, 'DECISION_UPDATED',
            jsonb_build_object('round', v_dec.round, 'decision', p_decision, 'version', v_dec.version));
  else
    insert into public.editorial_decisions (paper_id, round, decision, summary, confidential_note, review_ids, revision_due_at, decided_by)
    values (p_paper, v_paper.current_round, p_decision, trim(p_summary), nullif(trim(coalesce(p_note, '')), ''), v_ids,
            case when p_decision in ('MINOR_REVISION','MAJOR_REVISION') then p_due end, p_actor)
    returning * into v_dec;
    insert into public.paper_activity (paper_id, actor, action, detail)
    values (p_paper, p_actor, 'DECISION_CREATED', jsonb_build_object('round', v_dec.round, 'decision', p_decision));
  end if;

  return jsonb_build_object('id', v_dec.id, 'version', v_dec.version, 'round', v_dec.round);
end $$;

-- Communicate a saved decision to the author and apply its effect. The caller
-- passes the version it reviewed; if another manager changed the draft since,
-- this fails with STALE instead of releasing something nobody confirmed.
create or replace function public.release_editorial_decision(
  p_paper uuid, p_actor uuid, p_decision uuid, p_expected_version int
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_paper public.papers%rowtype;
  v_dec public.editorial_decisions%rowtype;
  v_rev uuid;
begin
  select * into v_paper from public.papers where id = p_paper for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(p_paper, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;

  select * into v_dec from public.editorial_decisions where id = p_decision and paper_id = p_paper for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if v_dec.released_at is not null then raise exception 'RPP:DECISION_EXISTS'; end if;
  if v_dec.version <> p_expected_version then raise exception 'RPP:STALE'; end if;
  if v_paper.status <> 'UNDER_REVIEW' or v_dec.round <> v_paper.current_round then
    raise exception 'RPP:NOT_UNDER_REVIEW';
  end if;

  if v_dec.decision = 'ACCEPT' then
    update public.papers set status = 'ACCEPTED' where id = p_paper;
    insert into public.paper_activity (paper_id, actor, action, detail)
    values (p_paper, p_actor, 'PAPER_ACCEPTED', jsonb_build_object('round', v_dec.round));
  elsif v_dec.decision = 'REJECT' then
    update public.papers set status = 'REJECTED' where id = p_paper;
    insert into public.paper_activity (paper_id, actor, action, detail)
    values (p_paper, p_actor, 'PAPER_REJECTED', jsonb_build_object('round', v_dec.round));
  else
    -- Reuse the Phase 3 revision request (its own checks, numbering, status
    -- change to REVISION and REVISION_REQUESTED activity) — same transaction.
    v_rev := public.request_paper_revision(
      p_paper, p_actor,
      case v_dec.decision when 'MINOR_REVISION' then 'MINOR' else 'MAJOR' end,
      v_dec.summary, v_dec.revision_due_at, v_dec.review_ids);
  end if;

  update public.editorial_decisions
     set released_at = now(), released_by = p_actor, revision_id = v_rev
   where id = v_dec.id;
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'DECISION_COMMUNICATED',
          jsonb_build_object('round', v_dec.round, 'decision', v_dec.decision));

  return jsonb_build_object('id', v_dec.id, 'decision', v_dec.decision, 'revisionId', v_rev);
end $$;

revoke all on function public._rpp_decision_immutable() from public, anon, authenticated;
revoke all on function public.save_editorial_decision(uuid, uuid, text, text, text, uuid[], timestamptz) from public, anon, authenticated;
revoke all on function public.release_editorial_decision(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.save_editorial_decision(uuid, uuid, text, text, text, uuid[], timestamptz) to service_role;
grant execute on function public.release_editorial_decision(uuid, uuid, uuid, int) to service_role;
