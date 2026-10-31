-- 0006_reviews — peer-review workflow (Phase 2).
--
-- One review row per (paper, reviewer): it starts as a DRAFT and transitions to
-- SUBMITTED, which prevents duplicate final reviews. Author-visible comments and
-- confidential-to-editor comments are SEPARATE columns; RLS lets a reviewer read
-- only their OWN review and admins read all — authors have no access here.
--
-- Also adds an optional review deadline to paper_assignments, and narrows the
-- paper_activity policy so AUTHORS only see allowlisted actions (assignment /
-- review events would reveal reviewer identity or a recommendation).
--
-- NOT YET APPLIED (shared prod project). Apply manually after review + backup.
-- Safe to run more than once.

-- Optional per-assignment review deadline.
alter table public.paper_assignments
  add column if not exists due_at timestamptz;

create table if not exists public.reviews (
  id                     uuid        primary key default gen_random_uuid(),
  paper_id               uuid        not null references public.papers (id) on delete cascade,
  reviewer               uuid        not null references auth.users (id) on delete cascade,
  status                 text        not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED')),
  recommendation         text        check (recommendation in ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT')),
  technical_quality      int         check (technical_quality between 1 and 5),
  originality            int         check (originality between 1 and 5),
  methodology            int         check (methodology between 1 and 5),
  clarity                int         check (clarity between 1 and 5),
  strengths              text,
  weaknesses             text,
  comments_to_author     text,       -- author-visible (in a later phase)
  confidential_to_editor text,       -- editor/admin only — never shown to authors
  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (paper_id, reviewer),        -- exactly one review per reviewer per paper
  -- A SUBMITTED review must be complete (defence in depth behind the API).
  constraint reviews_submitted_complete check (
    status = 'DRAFT' or (
      recommendation is not null and submitted_at is not null
      and technical_quality is not null and originality is not null
      and methodology is not null and clarity is not null
    )
  )
);
create index if not exists reviews_paper_idx on public.reviews (paper_id);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---- RLS -------------------------------------------------------------------
alter table public.reviews enable row level security;

-- A reviewer reads ONLY their own review; an admin reads all. Authors get no
-- access to reviews at all here (so confidential comments can never leak).
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (
  reviewer = auth.uid() or public.current_user_is_admin()
);

-- No INSERT/UPDATE/DELETE policies → only the service role (the API) writes,
-- after verifying the caller is the assigned reviewer. Consistent with the
-- rest of the project.

-- ---- paper_activity: authors see only allowlisted actions -----------------
-- Replaces the 0005 policy. Keep the action list in sync with
-- OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js.
drop policy if exists paper_activity_select on public.paper_activity;
create policy paper_activity_select on public.paper_activity for select using (
  public.current_user_is_admin()
  or (
    action in ('SUBMITTED')
    and exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  )
);
