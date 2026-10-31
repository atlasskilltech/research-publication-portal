-- 0009_publication_management — volumes, issues & publication (Phase 5).
--
-- Requires 0005–0008.
--
--   volumes       (volume_number, year)  unique per year     DRAFT → SCHEDULED → PUBLISHED
--   issues        (volume, issue_number) unique per volume   DRAFT → SCHEDULED → PUBLISHED
--   publications  one per paper (unique paper_id)            SCHEDULED → PUBLISHED
--
-- Paper lifecycle: an ACCEPTED paper (communicated ACCEPT decision, 0008) is
-- SCHEDULED into an issue, then PUBLISHED (papers.status = 'PUBLISHED').
-- Publication metadata is a SNAPSHOT (title, abstract, public author list,
-- keywords) — the original submission, manuscripts, reviews and decisions are
-- never modified. The author list holds names + affiliations only (no emails).
--
-- Public visibility = publication PUBLISHED and its issue PUBLISHED and its
-- volume PUBLISHED. Anonymous/authenticated roles get SELECT on SAFE COLUMNS
-- ONLY (column grants) so internal user ids, paper ids and storage references
-- can never be read through PostgREST, even for published rows.
--
-- Multi-record changes run in service-role-only functions with row locks.
-- Existing 0005–0008 policies are not modified.
--
-- NOT YET APPLIED. Apply to staging together with 0005–0008.
-- Safe to run more than once.

-- ---- Volumes ---------------------------------------------------------------
create table if not exists public.volumes (
  id            uuid        primary key default gen_random_uuid(),
  volume_number int         not null check (volume_number between 1 and 9999),
  year          int         not null check (year between 1900 and 2200),
  title         text        not null check (char_length(title) between 1 and 300),
  description   text        not null default '' check (char_length(description) <= 5000),
  status        text        not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','PUBLISHED')),
  published_at  timestamptz,
  created_by    uuid        references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (year, volume_number)
);
create index if not exists volumes_status_idx on public.volumes (status);

-- ---- Issues ----------------------------------------------------------------
create table if not exists public.issues (
  id               uuid        primary key default gen_random_uuid(),
  volume_id        uuid        not null references public.volumes (id) on delete restrict,
  issue_number     int         not null check (issue_number between 1 and 999),
  title            text        not null check (char_length(title) between 1 and 300),
  description      text        not null default '' check (char_length(description) <= 5000),
  publication_date date,
  status           text        not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','PUBLISHED')),
  published_at     timestamptz,
  created_by       uuid        references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (volume_id, issue_number),
  unique (id, volume_id)            -- target of the publications (issue, volume) FK
);
create index if not exists issues_volume_idx on public.issues (volume_id);
create index if not exists issues_status_idx on public.issues (status);

-- ---- Publications ----------------------------------------------------------
create table if not exists public.publications (
  id                uuid        primary key default gen_random_uuid(),
  paper_id          uuid        not null unique references public.papers (id) on delete restrict,  -- no duplicate publication
  volume_id         uuid        not null references public.volumes (id) on delete restrict,
  issue_id          uuid        not null,
  title             text        not null check (char_length(title) between 1 and 500),
  abstract          text        not null default '' check (char_length(abstract) <= 10000),
  authors           jsonb       not null check (jsonb_typeof(authors) = 'array' and jsonb_array_length(authors) between 1 and 50),
  keywords          text[]      not null default '{}' check (cardinality(keywords) <= 20),
  page_start        int         check (page_start >= 1),
  page_end          int,
  doi               text        check (doi ~ '^10\.[0-9]{4,9}/[^[:space:]]+$'),
  publication_date  date,
  manuscript_id     uuid        references public.paper_manuscripts (id) on delete restrict,       -- final manuscript reference
  manuscript_public boolean     not null default false,   -- explicit opt-in for public download
  status            text        not null default 'SCHEDULED' check (status in ('SCHEDULED','PUBLISHED')),
  version           int         not null default 1,       -- optimistic concurrency
  scheduled_by      uuid        references auth.users (id) on delete set null,
  scheduled_at      timestamptz not null default now(),
  published_by      uuid        references auth.users (id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- The issue MUST belong to the stated volume.
  constraint publications_issue_in_volume foreign key (issue_id, volume_id)
    references public.issues (id, volume_id) on delete restrict,
  constraint publications_page_range check (page_end is null or (page_start is not null and page_end >= page_start)),
  constraint publications_published_complete check (status = 'SCHEDULED' or (published_at is not null and publication_date is not null))
);
create unique index if not exists publications_doi_uidx on public.publications (lower(doi)) where doi is not null;
create index if not exists publications_issue_idx on public.publications (issue_id);
create index if not exists publications_status_idx on public.publications (status);

do $$
declare t text;
begin
  foreach t in array array['volumes','issues','publications'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---- RLS (rows) ------------------------------------------------------------
alter table public.volumes      enable row level security;
alter table public.issues       enable row level security;
alter table public.publications enable row level security;

-- Is the current user an EDITOR (role) — editors need the volume/issue list to
-- schedule their papers.
create or replace function public.current_user_is_editor()
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'EDITOR');
$$;

drop policy if exists volumes_select on public.volumes;
create policy volumes_select on public.volumes for select using (
  status = 'PUBLISHED' or public.current_user_is_admin() or public.current_user_is_editor()
);

drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues for select using (
  (status = 'PUBLISHED' and exists (select 1 from public.volumes v where v.id = volume_id and v.status = 'PUBLISHED'))
  or public.current_user_is_admin() or public.current_user_is_editor()
);

-- Public rows: fully published chain. Plus admin, the paper's editor, and the
-- paper's owner (authors may see their own record; they can't modify it).
drop policy if exists publications_select on public.publications;
create policy publications_select on public.publications for select using (
  (status = 'PUBLISHED'
    and exists (select 1 from public.issues i join public.volumes v on v.id = i.volume_id
                where i.id = issue_id and i.status = 'PUBLISHED' and v.status = 'PUBLISHED'))
  or public.current_user_is_admin()
  or public.current_user_is_paper_editor(paper_id)
  or exists (select 1 from public.papers p where p.id = paper_id and p.submitted_by = auth.uid())
);
-- No INSERT/UPDATE/DELETE policies → only the service role writes.

-- ---- Column privileges -----------------------------------------------------
-- Row policies can't hide columns, so client roles may read SAFE columns only.
-- The server API (service role) is unaffected.
revoke all on public.volumes, public.issues, public.publications from anon, authenticated;
grant select (id, volume_number, year, title, description, status, published_at, created_at, updated_at)
  on public.volumes to anon, authenticated;
grant select (id, volume_id, issue_number, title, description, publication_date, status, published_at, created_at, updated_at)
  on public.issues to anon, authenticated;
grant select (id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi,
              publication_date, manuscript_public, status, published_at)
  on public.publications to anon, authenticated;
-- Deliberately NOT granted: paper_id, manuscript_id, scheduled_by, published_by,
-- created_by, version (internal ids / storage references).

-- ---- Transactional functions (service role only) ---------------------------

create or replace function public._rpp_is_admin(p_actor uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_actor and is_admin);
$$;

-- Volume status: DRAFT ⇄ SCHEDULED, → PUBLISHED (final). Admin only.
create or replace function public.set_volume_status(p_volume uuid, p_actor uuid, p_status text)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v public.volumes%rowtype;
begin
  if not public._rpp_is_admin(p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  select * into v from public.volumes where id = p_volume for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if p_status not in ('DRAFT','SCHEDULED','PUBLISHED') then raise exception 'RPP:BAD_STATUS'; end if;
  if v.status = 'PUBLISHED' then raise exception 'RPP:ALREADY_PUBLISHED'; end if;
  if v.status = p_status then return; end if;
  update public.volumes
     set status = p_status, published_at = case when p_status = 'PUBLISHED' then now() end
   where id = p_volume;
end $$;

-- Issue status: DRAFT ⇄ SCHEDULED, → PUBLISHED (final; volume must be
-- PUBLISHED). With p_publish_papers, every SCHEDULED paper in the issue whose
-- paper is still ACCEPTED is published in the SAME transaction.
create or replace function public.set_issue_status(p_issue uuid, p_actor uuid, p_status text, p_publish_papers boolean)
returns int language plpgsql set search_path = public, pg_temp as $$
declare
  i public.issues%rowtype;
  v_vol_status text;
  v_count int := 0;
  r record;
begin
  if not public._rpp_is_admin(p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  select * into i from public.issues where id = p_issue for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if p_status not in ('DRAFT','SCHEDULED','PUBLISHED') then raise exception 'RPP:BAD_STATUS'; end if;
  if i.status = 'PUBLISHED' and p_status <> 'PUBLISHED' then raise exception 'RPP:ALREADY_PUBLISHED'; end if;

  if p_status = 'PUBLISHED' then
    select status into v_vol_status from public.volumes where id = i.volume_id for update;
    if v_vol_status <> 'PUBLISHED' then raise exception 'RPP:VOLUME_NOT_PUBLISHED'; end if;
    if i.status <> 'PUBLISHED' then
      update public.issues
         set status = 'PUBLISHED', published_at = now(), publication_date = coalesce(publication_date, current_date)
       where id = p_issue
       returning * into i;
    end if;
    if coalesce(p_publish_papers, false) then
      for r in
        select pb.id, pb.paper_id from public.publications pb
          join public.papers p on p.id = pb.paper_id
         where pb.issue_id = p_issue and pb.status = 'SCHEDULED' and p.status = 'ACCEPTED'
         for update of pb, p
      loop
        update public.publications
           set status = 'PUBLISHED', published_at = now(), published_by = p_actor,
               publication_date = coalesce(publication_date, i.publication_date), version = version + 1
         where id = r.id;
        update public.papers set status = 'PUBLISHED' where id = r.paper_id;
        insert into public.paper_activity (paper_id, actor, action, detail)
        values (r.paper_id, p_actor, 'PAPER_PUBLISHED', jsonb_build_object('issueId', p_issue, 'viaIssue', true));
        v_count := v_count + 1;
      end loop;
    end if;
  elsif i.status <> p_status then
    update public.issues set status = p_status where id = p_issue;
  end if;
  return v_count;
end $$;

-- Schedule an ACCEPTED paper into an issue (creates the publication record).
create or replace function public.schedule_publication(
  p_paper uuid, p_actor uuid, p_volume uuid, p_issue uuid,
  p_title text, p_abstract text, p_authors jsonb, p_keywords text[],
  p_page_start int, p_page_end int, p_doi text, p_pub_date date,
  p_manuscript uuid, p_manuscript_public boolean
) returns uuid language plpgsql set search_path = public, pg_temp as $$
declare
  v_paper public.papers%rowtype;
  v_issue public.issues%rowtype;
  v_id uuid;
begin
  select * into v_paper from public.papers where id = p_paper for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(p_paper, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_paper.status = 'REJECTED' then raise exception 'RPP:PAPER_REJECTED'; end if;
  if v_paper.status = 'REVISION' then raise exception 'RPP:REVISION_PENDING'; end if;
  if v_paper.status <> 'ACCEPTED' then raise exception 'RPP:NOT_ACCEPTED'; end if;
  -- Must be backed by a COMMUNICATED ACCEPT decision (0008).
  if not exists (select 1 from public.editorial_decisions
                 where paper_id = p_paper and decision = 'ACCEPT' and released_at is not null) then
    raise exception 'RPP:NOT_ACCEPTED';
  end if;
  if exists (select 1 from public.publications where paper_id = p_paper) then raise exception 'RPP:ALREADY_SCHEDULED'; end if;

  select * into v_issue from public.issues where id = p_issue;
  if not found then raise exception 'RPP:ISSUE_NOT_FOUND'; end if;
  if v_issue.volume_id <> p_volume then raise exception 'RPP:ISSUE_VOLUME_MISMATCH'; end if;
  if p_manuscript is not null and not exists (select 1 from public.paper_manuscripts where id = p_manuscript and paper_id = p_paper) then
    raise exception 'RPP:BAD_MANUSCRIPT';
  end if;

  insert into public.publications (paper_id, volume_id, issue_id, title, abstract, authors, keywords,
                                   page_start, page_end, doi, publication_date, manuscript_id, manuscript_public, scheduled_by)
  values (p_paper, p_volume, p_issue, p_title, coalesce(p_abstract, ''), p_authors, coalesce(p_keywords, '{}'),
          p_page_start, p_page_end, nullif(p_doi, ''), p_pub_date, p_manuscript, coalesce(p_manuscript_public, false), p_actor)
  returning id into v_id;

  insert into public.paper_activity (paper_id, actor, action, detail)
  values (p_paper, p_actor, 'PUBLICATION_SCHEDULED', jsonb_build_object('issueId', p_issue, 'volumeId', p_volume));
  return v_id;
end $$;

-- Edit a SCHEDULED publication (metadata and/or issue). Published records are final.
create or replace function public.update_publication(
  p_pub uuid, p_actor uuid, p_expected_version int, p_volume uuid, p_issue uuid,
  p_title text, p_abstract text, p_authors jsonb, p_keywords text[],
  p_page_start int, p_page_end int, p_doi text, p_pub_date date,
  p_manuscript uuid, p_manuscript_public boolean
) returns int language plpgsql set search_path = public, pg_temp as $$
declare
  v_pub public.publications%rowtype;
  v_issue public.issues%rowtype;
begin
  select * into v_pub from public.publications where id = p_pub for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(v_pub.paper_id, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_pub.status = 'PUBLISHED' then raise exception 'RPP:ALREADY_PUBLISHED'; end if;
  if v_pub.version <> p_expected_version then raise exception 'RPP:STALE'; end if;

  select * into v_issue from public.issues where id = p_issue;
  if not found then raise exception 'RPP:ISSUE_NOT_FOUND'; end if;
  if v_issue.volume_id <> p_volume then raise exception 'RPP:ISSUE_VOLUME_MISMATCH'; end if;
  if p_manuscript is not null and not exists (select 1 from public.paper_manuscripts where id = p_manuscript and paper_id = v_pub.paper_id) then
    raise exception 'RPP:BAD_MANUSCRIPT';
  end if;

  update public.publications
     set volume_id = p_volume, issue_id = p_issue, title = p_title, abstract = coalesce(p_abstract, ''),
         authors = p_authors, keywords = coalesce(p_keywords, '{}'), page_start = p_page_start, page_end = p_page_end,
         doi = nullif(p_doi, ''), publication_date = p_pub_date, manuscript_id = p_manuscript,
         manuscript_public = coalesce(p_manuscript_public, false), version = version + 1
   where id = p_pub
   returning version into v_pub.version;

  insert into public.paper_activity (paper_id, actor, action, detail)
  values (v_pub.paper_id, p_actor, 'PUBLICATION_UPDATED', jsonb_build_object('version', v_pub.version));
  return v_pub.version;
end $$;

-- Publish one SCHEDULED paper. Its issue (and therefore volume) must be PUBLISHED.
create or replace function public.publish_paper(p_pub uuid, p_actor uuid, p_expected_version int)
returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_pub public.publications%rowtype;
  v_paper public.papers%rowtype;
  v_issue public.issues%rowtype;
begin
  select * into v_pub from public.publications where id = p_pub for update;
  if not found then raise exception 'RPP:NOT_FOUND'; end if;
  if not public._rpp_is_manager(v_pub.paper_id, p_actor) then raise exception 'RPP:FORBIDDEN'; end if;
  if v_pub.status = 'PUBLISHED' then raise exception 'RPP:ALREADY_PUBLISHED'; end if;
  if v_pub.version <> p_expected_version then raise exception 'RPP:STALE'; end if;

  select * into v_paper from public.papers where id = v_pub.paper_id for update;
  if v_paper.status = 'REJECTED' then raise exception 'RPP:PAPER_REJECTED'; end if;
  if v_paper.status = 'REVISION' then raise exception 'RPP:REVISION_PENDING'; end if;
  if v_paper.status <> 'ACCEPTED' then raise exception 'RPP:NOT_ACCEPTED'; end if;

  select * into v_issue from public.issues where id = v_pub.issue_id;
  if v_issue.status <> 'PUBLISHED' then raise exception 'RPP:ISSUE_NOT_PUBLISHED'; end if;

  update public.publications
     set status = 'PUBLISHED', published_at = now(), published_by = p_actor,
         publication_date = coalesce(publication_date, v_issue.publication_date, current_date), version = version + 1
   where id = p_pub;
  update public.papers set status = 'PUBLISHED' where id = v_pub.paper_id;
  insert into public.paper_activity (paper_id, actor, action, detail)
  values (v_pub.paper_id, p_actor, 'PAPER_PUBLISHED', jsonb_build_object('issueId', v_pub.issue_id));
end $$;

revoke all on function public._rpp_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.set_volume_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_issue_status(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.schedule_publication(uuid, uuid, uuid, uuid, text, text, jsonb, text[], int, int, text, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.update_publication(uuid, uuid, int, uuid, uuid, text, text, jsonb, text[], int, int, text, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.publish_paper(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public._rpp_is_admin(uuid) to service_role;
grant execute on function public.set_volume_status(uuid, uuid, text) to service_role;
grant execute on function public.set_issue_status(uuid, uuid, text, boolean) to service_role;
grant execute on function public.schedule_publication(uuid, uuid, uuid, uuid, text, text, jsonb, text[], int, int, text, date, uuid, boolean) to service_role;
grant execute on function public.update_publication(uuid, uuid, int, uuid, uuid, text, text, jsonb, text[], int, int, text, date, uuid, boolean) to service_role;
grant execute on function public.publish_paper(uuid, uuid, int) to service_role;
