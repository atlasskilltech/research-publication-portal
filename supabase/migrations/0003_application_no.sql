-- 0003_application_no — student Application Number on the profile.
--
-- Student self-registration now verifies an Application Number against the
-- university dashboard API (replacing the old roll-number field) and must
-- prevent the same application number from being registered twice. This adds
-- the column, a case-normalised uniqueness guard, and teaches the
-- handle_new_user() trigger to copy it from the signup/invite metadata.
--
-- Safe to run more than once.

alter table public.profiles
  add column if not exists application_no text;

-- One account per application number. Partial + lower() so it only constrains
-- rows that actually carry a number (faculty never do) and is case-insensitive.
create unique index if not exists profiles_application_no_key
  on public.profiles (lower(application_no))
  where application_no is not null;

-- Recreate the signup trigger function so a new auth user's profile also
-- carries application_no. Still SECURITY DEFINER and still hard-codes
-- is_admin = false — privilege can never arrive through metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, name, base_type, school_code, roll_no, application_no, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(nullif(upper(new.raw_user_meta_data ->> 'base_type'), ''), 'STUDENT'),
    new.raw_user_meta_data ->> 'school_code',
    new.raw_user_meta_data ->> 'roll_no',
    new.raw_user_meta_data ->> 'application_no',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
