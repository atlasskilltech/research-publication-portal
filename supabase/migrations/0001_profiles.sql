-- 0001_profiles — application profile for every Supabase Auth user.
--
-- Supabase Auth owns identities, emails and passwords in `auth.users`. This
-- table holds the Research Publication Portal's own per-user fields and the
-- single account-level role flag (`is_admin`). It is 1:1 with `auth.users` and
-- is created and kept in sync by the trigger below — the application never
-- INSERTs a profile directly.
--
-- Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE), so it can be
-- pasted into the Supabase SQL Editor without worrying about re-runs.

create table if not exists public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  email       text,
  name        text        not null default '',
  base_type   text        not null default 'STUDENT'
                check (base_type in ('STUDENT', 'FACULTY')),
  is_admin    boolean     not null default false,
  school_code text,
  roll_no     text,
  legacy_id   text,                               -- old MySQL CUID, for traceability only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_is_admin_idx on public.profiles (is_admin);

-- Keep `updated_at` honest on every change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile when a new auth user is created.
--
-- SECURITY DEFINER so it can write to public.profiles regardless of the caller's
-- RLS. It reads ONLY non-privileged fields from the signup metadata and
-- hard-codes is_admin = false, so a registrant can never grant themselves admin
-- by crafting metadata. Administrators are elevated separately and deliberately
-- by the service-role provisioning script.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, name, base_type, school_code, roll_no, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(nullif(upper(new.raw_user_meta_data ->> 'base_type'), ''), 'STUDENT'),
    new.raw_user_meta_data ->> 'school_code',
    new.raw_user_meta_data ->> 'roll_no',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
