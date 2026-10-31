-- 0007_revisions — author revision & resubmission (Phase 3).
--
-- Requires 0005 (submissions) and 0006 (reviews).
--
-- Adds:
--   * versioned manuscripts  (paper_manuscripts.version; 0 = original, n = revision n)
--   * review rounds          (reviews.round; unique per paper+reviewer+round)
--   * papers.current_round   (round of the latest manuscript the author submitted)
--   * paper_revisions        (an editor/admin revision REQUEST + the author's
--                             point-by-point responses + its lifecycle)
--   * transactional functions for every revision state change, executable by
--     the service role ONLY (the API authorizes the caller, the function
--     re-checks and locks rows so concurrent requests can't double-apply)
--   * RLS: reviewers only see RELEASED manuscript versions; paper editors may
--     read reviews/revisions of their papers; authors see revision events only.
--
-- Revision lifecycle (paper_revisions.status). REVISION_OVERDUE is DERIVED
-- (deadline passed while REQUESTED/IN_PROGRESS), never stored:
--
--   (none) ──manager──▶ REVISION_REQUESTED ──author──▶ REVISION_IN_PROGRESS
--                              │                            │
--                              └──────author (submit)───────┴──▶ REVISION_SUBMITTED
--                                                                   │
--                                               manager (re-review) ▼
--                                                         REVISION_UNDER_REVIEW
--
-- No acceptance / rejection / publication decisions here (later phase).
--
-- NOT YET APPLIED (shared prod project). Apply manually to staging first.
-- Safe to run more than once.

-- ---- Versioned manuscripts -------------------------------------------------
alter table public.paper_manuscripts
  add column if not exists version int not null default 0;
do $$ begin
  alter table public.paper_manuscripts add constraint paper_manuscripts_version_nonneg check (version >= 0);
exception when duplicate_object then null; end $$;
-- One file per (paper, version). Version 0 is the original and is never touched
-- by the revision functions (they only write version = revision round >= 1).
create unique index if not exists paper_manuscripts_paper_version_uidx
  on public.paper_manuscripts (paper_id, version);

-- ---- Rounds ----------------------------------------------------------------
alter table public.papers
  add column if not exists current_round int not null default 0;

alter table public.reviews
  add column if not exists round int not null default 0;
-- Replace the 0006 one-review-per-reviewer rule with one-per-reviewer-PER-ROUND,
-- so a re-review never overwrites the earlier round's record.
alter table public.reviews drop constraint if exists reviews_paper_id_reviewer_key;
create unique index if not exists reviews_paper_reviewer_round_uidx
  on public.reviews (paper_id, reviewer, round);

-- ---- Revision requests -----------------------------------------------------
create table if not exists public.paper_revisions (
  id                  uuid        primary key default gen_random_uuid(),
  paper_id            uuid        not null references public.papers (id) on delete cascade,
  round               int         not null check (round >= 1),       -- revision number
  revision_type       text        not null check (revision_type in ('MINOR','MAJOR')),
  instructions        text        not null default '' check (char_length(instructions) <= 10000),
  due_at              timestamptz,
  status              text        not null default 'REVISION_REQUESTED'
                        check (status in ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED','REVISION_UNDER_REVIEW')),
  -- Reviews the editor RELEASED to the author with this request. Only their
  -- comments_to_author are ever shown to the author (via the API).
  review_ids          uuid[]      not null default '{}',
  -- Author's point-by-point response: [{review_id|null, comment, response, addressed}]
  responses           jsonb       not null default '[]'::jsonb check (jsonb_typeof(responses) = 'array'),
  requested_by        uuid        references auth.users (id) on delete set null,
  requested_at        timestamptz not null default now(),
  started_at          timestamptz,
  submitted_at        timestamptz,
  submitted_by        uuid        references auth.users (id) on delete set null,
  rereview_started_at timestamptz,
  updated_at          timestamptz not null default now(),
  unique (paper_id, round)
);
create index if not exists paper_revisions_paper_idx on public.paper_revisions (paper_id);
-- At most ONE open revision per paper (blocks duplicate concurrent requests).
create unique index if not exists paper_revisions_one_open
  on public.paper_revisions (paper_id)
  where status in ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED');

drop trigger if exists paper_revisions_set_updated_at on public.paper_revisions;
create trigger paper_revisions_set_updated_at
  before update on public.paper_revisions
  for each row execute function public.set_updated_at();

-- ---- Helper functions (used by RLS) ---------------------------------------
-- Highest round whose revised manuscript has been released for re-review
-- (0 = only the original). Reviewers may read manuscript versions <= this.
create or replace function public.paper_released_round(p_paper uuid)
returns int language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(max(round), 0) from public.paper_revisions
  where paper_id = p_paper and status = 'REVISION_UNDER_REVIEW';
$$;

-- Is the current user assigned as EDITOR on this paper?
create or replace function public.current_user_is_paper_editor(p_paper uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.paper_assignments a
    where a.paper_id = p_paper and a.assignee = auth.uid() and a.role = 'EDITOR'
  );
$$;

-- ---- RLS -------------------------------------------------------------------
alter table public.paper_revisions enable row level security;

-- Revisions (incl. the author's responses): owner, admin, or the paper's editor.
-- Reviewers get only the responses addressed to THEM, via the API.
drop policy if exists paper_revisions_select on public.paper_revisions;
create policy paper_revisions_select on public.paper_revisions for select using (
  public.current_user_is_admin()
  or public.current_user_is_paper_editor(paper_id)
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
);

-- Reviews: own, admin, or the paper's editor. Still NO author access, so
-- confidential_to_editor can never reach an author through the database.
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (
  reviewer = auth.uid() or public.current_user_is_admin() or public.current_user_is_paper_editor(paper_id)
);

-- Manuscripts: owner/admin see every version; an assigned user sees only
-- RELEASED versions (never a revision still being prepared or awaiting release).
drop policy if exists paper_manuscripts_select on public.paper_manuscripts;
create policy paper_manuscripts_select on public.paper_manuscripts for select using (
  public.current_user_is_admin()
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  or (public.current_user_assigned(paper_id) and version <= public.paper_released_round(paper_id))
);

-- Activity: authors see only allowlisted events (no reviewer activity).
-- Keep in sync with OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js.
drop policy if exists paper_activity_select on public.paper_activity;
create policy paper_activity_select on public.paper_activity for select using (
  public.current_user_is_admin()
  or (
    action in ('SUBMITTED','REVISION_REQUESTED','REVISION_STARTED','REVISION_MANUSCRIPT_UPLOADED','REVISION_RESPONSE_SAVED','REVISION_SUBMITTED','REREVIEW_ASSIGNED')
    and exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  )
);

-- ---- Transactional state changes ------------------------------------------
-- Each function locks the relevant row(s) FOR UPDATE, re-checks authorization
-- and the allowed transition, and writes everything (+ activity) in ONE
-- transaction. Errors are raised as 'RPP:<CODE>' and mapped to HTTP statuses
-- by lib/revisionLogic.js (mapRpcError).

create or replace function public._rpp_is_manager(p_paper uuid, p_actor uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_actor and is_admin)
      or exists (select 1 from public.paper_assignments
                 where paper_id = p_paper and assignee = p_actor and role = 'EDITOR');
$$;

-- Manager issues a revision request for the paper's current round.
create or replace function public.request_paper_revision(
  p_paper uuid, p_actor uuid, p_type text, p_instructions text, p_due timestamptz, p_review_ids uuid[]
) returns uuid language plpgsql set search_path = public, pg_temp as $$
declare
  v_paper public.papers%rowtype;
  v_wanted int;
  v_valid int;
  v_id uuid;
begin
  select * into v_paper from public.papers where id = p_paper for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(p_paper, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_paper.status <> 'UNDER_REVIEW' then raise exception 'RPP:NOT_UNDER_REVIEW'; end if;
  if p_type not in ('MINOR','MAJOR') then raise exception 'RPP:BAD_TYPE'; end if;
  if exists (select 1 from public.paper_revisions where paper_id = p_paper
             and status in ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED')) then
    raise exception 'RPP:OPEN_REVISION';
  end if;

  -- Released reviews must be SUBMITTED reviews of THIS paper's current round.
  select count(distinct x) into v_wanted from unnest(coalesce(p_review_ids, '{}')) as x;
  if v_wanted = 0 then raise exception 'RPP:NO_REVIEWS'; end if;
  select count(*) into v_valid from public.reviews
   where id = any(p_review_ids) and paper_id = p_paper
     and round = v_paper.current_round and status = 'SUBMITTED';
  if v_valid <> v_wanted then raise exception 'RPP:BAD_REVIEWS'; end if;

  insert into public.paper_revisions (paper_id, round, revision_type, instructions, due_at, review_ids, requested_by)
  values (p_paper, v_paper.current_round + 1, p_type, coalesce(p_instructions, ''), p_due,
          array(select distinct x from unnest(p_review_ids) as x), p_actor)
  returning id into v_id;

  update public.papers set status = 'REVISION' where id = p_paper;
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'REVISION_REQUESTED',
          jsonb_build_object('round', v_paper.current_round + 1, 'type', p_type, 'dueAt', p_due));
  return v_id;
end $$;

-- Lock + authorize an author-editable revision. Returns the locked row.
create or replace function public._rpp_lock_editable(p_paper uuid, p_round int, p_actor uuid)
returns public.paper_revisions language plpgsql set search_path = public, pg_temp as $$
declare v_rev public.paper_revisions%rowtype;
begin
  select * into v_rev from public.paper_revisions where paper_id = p_paper and round = p_round for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not exists (select 1 from public.papers where id = p_paper and submitted_by = p_actor) then
    raise exception 'RPP:FORBIDDEN';
  end if;
  if v_rev.status in ('REVISION_SUBMITTED','REVISION_UNDER_REVIEW') then raise exception 'RPP:ALREADY_SUBMITTED'; end if;
  return v_rev;
end $$;

-- Mark REQUESTED → IN_PROGRESS (first author action). Logs REVISION_STARTED once.
create or replace function public._rpp_mark_started(v_rev public.paper_revisions, p_actor uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if v_rev.status = 'REVISION_REQUESTED' then
    update public.paper_revisions set status = 'REVISION_IN_PROGRESS', started_at = now() where id = v_rev.id;
    insert into public.paper_activity (paper_id, actor, action, detail)
    values (v_rev.paper_id, p_actor, 'REVISION_STARTED', jsonb_build_object('round', v_rev.round));
  end if;
end $$;

-- Author attaches (or replaces, while still a draft) the revised manuscript for
-- this round. Returns the REPLACED draft's storage key (caller deletes that
-- file) or null. Version = round >= 1, so the original (0) and every earlier
-- round's file are never modified.
create or replace function public.attach_revision_manuscript(
  p_paper uuid, p_round int, p_actor uuid,
  p_key text, p_filename text, p_mime text, p_size bigint, p_sha text
) returns text language plpgsql set search_path = public, pg_temp as $$
declare
  v_rev public.paper_revisions%rowtype;
  v_old text;
begin
  v_rev := public._rpp_lock_editable(p_paper, p_round, p_actor);

  select storage_key into v_old from public.paper_manuscripts where paper_id = p_paper and version = p_round;
  if v_old is not null then
    update public.paper_manuscripts
       set storage_key = p_key, original_filename = p_filename, mime_type = p_mime,
           byte_size = p_size, sha256 = p_sha, uploaded_by = p_actor, created_at = now()
     where paper_id = p_paper and version = p_round;
  else
    insert into public.paper_manuscripts (paper_id, version, storage_key, original_filename, mime_type, byte_size, sha256, uploaded_by)
    values (p_paper, p_round, p_key, p_filename, p_mime, p_size, p_sha, p_actor);
  end if;

  perform public._rpp_mark_started(v_rev, p_actor);
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'REVISION_MANUSCRIPT_UPLOADED',
          jsonb_build_object('round', p_round, 'bytes', p_size, 'replaced', v_old is not null));
  return v_old;
end $$;

-- Author saves draft responses.
create or replace function public.save_revision_draft(
  p_paper uuid, p_round int, p_actor uuid, p_responses jsonb
) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_rev public.paper_revisions%rowtype;
begin
  v_rev := public._rpp_lock_editable(p_paper, p_round, p_actor);
  update public.paper_revisions set responses = coalesce(p_responses, '[]'::jsonb) where id = v_rev.id;
  perform public._rpp_mark_started(v_rev, p_actor);
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'REVISION_RESPONSE_SAVED',
          jsonb_build_object('round', p_round, 'entries', jsonb_array_length(coalesce(p_responses, '[]'::jsonb))));
end $$;

-- Author submits the revision. Requires this round's manuscript. The row lock +
-- status check make a second (or concurrent) submit fail with ALREADY_SUBMITTED.
create or replace function public.submit_paper_revision(
  p_paper uuid, p_round int, p_actor uuid, p_responses jsonb
) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_rev public.paper_revisions%rowtype;
begin
  v_rev := public._rpp_lock_editable(p_paper, p_round, p_actor);
  if not exists (select 1 from public.paper_manuscripts where paper_id = p_paper and version = p_round) then
    raise exception 'RPP:NO_MANUSCRIPT';
  end if;
  if jsonb_array_length(coalesce(p_responses, '[]'::jsonb)) = 0 then raise exception 'RPP:NO_RESPONSES'; end if;

  update public.paper_revisions
     set status = 'REVISION_SUBMITTED', responses = p_responses,
         started_at = coalesce(started_at, now()), submitted_at = now(), submitted_by = p_actor
   where id = v_rev.id;
  -- The submitted version becomes the paper's current round (status stays
  -- REVISION until a manager releases it for re-review).
  update public.papers set current_round = p_round where id = p_paper;
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'REVISION_SUBMITTED', jsonb_build_object('round', p_round));
end $$;

-- Manager releases a submitted revision to the assigned reviewers.
create or replace function public.start_revision_rereview(
  p_paper uuid, p_round int, p_actor uuid, p_due timestamptz
) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_rev public.paper_revisions%rowtype;
begin
  select * into v_rev from public.paper_revisions where paper_id = p_paper and round = p_round for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(p_paper, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_rev.status <> 'REVISION_SUBMITTED' then raise exception 'RPP:NOT_SUBMITTED'; end if;
  if not exists (select 1 from public.paper_assignments where paper_id = p_paper
                 and role in ('PEER_REVIEWER','DESK_REVIEWER')) then
    raise exception 'RPP:NO_REVIEWERS';
  end if;

  update public.paper_revisions set status = 'REVISION_UNDER_REVIEW', rereview_started_at = now() where id = v_rev.id;
  update public.papers set status = 'UNDER_REVIEW' where id = p_paper;
  if p_due is not null then
    update public.paper_assignments set due_at = p_due
     where paper_id = p_paper and role in ('PEER_REVIEWER','DESK_REVIEWER');
  end if;
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'REREVIEW_ASSIGNED', jsonb_build_object('round', p_round, 'dueAt', p_due));
end $$;

-- Only the service role (the server API) may call the state-change functions.
-- Without this, any signed-in user could call them via PostgREST with a forged
-- p_actor.
revoke all on function public._rpp_is_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_paper_revision(uuid, uuid, text, text, timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function public._rpp_lock_editable(uuid, int, uuid) from public, anon, authenticated;
revoke all on function public._rpp_mark_started(public.paper_revisions, uuid) from public, anon, authenticated;
revoke all on function public.attach_revision_manuscript(uuid, int, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.save_revision_draft(uuid, int, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.submit_paper_revision(uuid, int, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.start_revision_rereview(uuid, int, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.request_paper_revision(uuid, uuid, text, text, timestamptz, uuid[]) to service_role;
grant execute on function public.attach_revision_manuscript(uuid, int, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.save_revision_draft(uuid, int, uuid, jsonb) to service_role;
grant execute on function public.submit_paper_revision(uuid, int, uuid, jsonb) to service_role;
grant execute on function public.start_revision_rereview(uuid, int, uuid, timestamptz) to service_role;
grant execute on function public._rpp_is_manager(uuid, uuid) to service_role;
grant execute on function public._rpp_lock_editable(uuid, int, uuid) to service_role;
grant execute on function public._rpp_mark_started(public.paper_revisions, uuid) to service_role;
