-- 0005_submissions — real paper submission system (Phase 1).
--
-- Separates reviewer-facing paper data (public.papers) from author identity
-- (public.paper_authors) to support DOUBLE-BLIND review: reviewers may read a
-- paper row but never the authors. Manuscript BYTES live on the EC2 filesystem
-- (never Supabase Storage); only metadata is stored here. Writes happen solely
-- through the service role (the API) — there are no authenticated write
-- policies, matching the existing profiles/user_roles design.
--
-- NOT YET APPLIED. Local shares the production Supabase project, so this must
-- only run against a dedicated staging project (see the audit notes).
--
-- Safe to run more than once.

-- ---- Reviewer-facing paper (NO author identity here) -----------------------
create table if not exists public.papers (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null,
  abstract     text        not null default '',
  keywords     text[]      not null default '{}',
  school_code  text,
  status       text        not null default 'SUBMITTED'
                 check (status in ('SUBMITTED','UNDER_REVIEW','REVISION','ACCEPTED','REJECTED','PUBLISHED','ARCHIVED')),
  -- Owner/audit. set null (not cascade) so deleting a user never destroys the
  -- scholarly record; set null (not restrict) so user deletion is never blocked.
  submitted_by uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists papers_submitted_by_idx on public.papers (submitted_by);
create index if not exists papers_status_idx on public.papers (status);

drop trigger if exists papers_set_updated_at on public.papers;
create trigger papers_set_updated_at
  before update on public.papers
  for each row execute function public.set_updated_at();

-- ---- Author identity (kept SEPARATE for double-blind) ----------------------
create table if not exists public.paper_authors (
  id               uuid    primary key default gen_random_uuid(),
  paper_id         uuid    not null references public.papers (id) on delete cascade,
  full_name        text    not null,
  email            text,
  affiliation      text,
  is_corresponding boolean not null default false,
  author_order     int     not null,
  created_at       timestamptz not null default now(),
  unique (paper_id, author_order)            -- preserve a stable author order
);
create index if not exists paper_authors_paper_idx on public.paper_authors (paper_id);
-- At most ONE corresponding author per paper (the API also enforces exactly one).
create unique index if not exists paper_authors_one_corresponding
  on public.paper_authors (paper_id) where is_corresponding;

-- ---- Manuscript file metadata (bytes live on the EC2 filesystem) -----------
create table if not exists public.paper_manuscripts (
  id                uuid        primary key default gen_random_uuid(),
  paper_id          uuid        not null references public.papers (id) on delete cascade,
  storage_key       text        not null unique,   -- server-generated, unpredictable; NOT a path
  original_filename text,                           -- for owner/admin display only
  mime_type         text        not null,
  byte_size         bigint      not null,
  sha256            text        not null,
  uploaded_by       uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists paper_manuscripts_paper_idx on public.paper_manuscripts (paper_id);

-- ---- Per-paper assignments (reuse the user_roles vocabulary) ---------------
create table if not exists public.paper_assignments (
  id          uuid        primary key default gen_random_uuid(),
  paper_id    uuid        not null references public.papers (id) on delete cascade,
  assignee    uuid        not null references auth.users (id) on delete cascade,
  role        text        not null check (role in ('SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR')),
  assigned_by uuid        references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (paper_id, assignee, role)
);
create index if not exists paper_assignments_paper_idx on public.paper_assignments (paper_id);
create index if not exists paper_assignments_assignee_idx on public.paper_assignments (assignee);

-- ---- Audit trail -----------------------------------------------------------
create table if not exists public.paper_activity (
  id         uuid        primary key default gen_random_uuid(),
  paper_id   uuid        not null references public.papers (id) on delete cascade,
  actor      uuid        references auth.users (id) on delete set null,
  action     text        not null,
  detail     jsonb       not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists paper_activity_paper_idx on public.paper_activity (paper_id, created_at desc);

-- ---- RLS -------------------------------------------------------------------
alter table public.papers            enable row level security;
alter table public.paper_authors     enable row level security;
alter table public.paper_manuscripts enable row level security;
alter table public.paper_assignments enable row level security;
alter table public.paper_activity    enable row level security;

-- "Is the current user assigned to this paper?" SECURITY DEFINER so it can be
-- used inside the papers policy without recursing through paper_assignments RLS.
create or replace function public.current_user_assigned(p_paper uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.paper_assignments a
    where a.paper_id = p_paper and a.assignee = auth.uid()
  );
$$;

-- papers: owner, admin, or an assigned reviewer may read the reviewer-facing row.
drop policy if exists papers_select on public.papers;
create policy papers_select on public.papers for select using (
  submitted_by = auth.uid() or public.current_user_is_admin() or public.current_user_assigned(id)
);

-- paper_authors: owner or admin ONLY. Reviewers are deliberately excluded →
-- double-blind is enforced at the database, not just in API code.
drop policy if exists paper_authors_select on public.paper_authors;
create policy paper_authors_select on public.paper_authors for select using (
  public.current_user_is_admin()
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
);

-- paper_manuscripts: owner, admin, or assigned reviewer (reviewers need the file).
drop policy if exists paper_manuscripts_select on public.paper_manuscripts;
create policy paper_manuscripts_select on public.paper_manuscripts for select using (
  public.current_user_is_admin()
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
  or public.current_user_assigned(paper_id)
);

-- paper_assignments: the assignee or an admin.
drop policy if exists paper_assignments_select on public.paper_assignments;
create policy paper_assignments_select on public.paper_assignments for select using (
  assignee = auth.uid() or public.current_user_is_admin()
);

-- paper_activity: owner or admin.
drop policy if exists paper_activity_select on public.paper_activity;
create policy paper_activity_select on public.paper_activity for select using (
  public.current_user_is_admin()
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
);

-- No INSERT/UPDATE/DELETE policies anywhere above → only the service role (the
-- server-side API) can write, consistent with the existing project.
