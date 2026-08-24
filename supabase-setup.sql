-- ============================================================
-- Ganesh Pooja Expense Portal — complete Supabase setup
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query
-- (This is the only script you need — it replaces all the
-- separate migration files sent earlier.)
-- ============================================================

-- ---------- profiles ----------
-- Roles: super_admin (full access), treasurer (expenses + transfers),
-- donation_collector (donations + flat edits), viewer (read-only, default).
create table if not exists public.ganesh_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer'
    check (role in ('super_admin','treasurer','donation_collector','viewer')),
  created_at timestamptz not null default now()
);

-- ---------- settings (single row) ----------
create table if not exists public.ganesh_settings (
  id int primary key default 1 check (id = 1),
  committee_name text not null default 'Ganesh Pooja Committee',
  updated_at timestamptz not null default now()
);
insert into public.ganesh_settings (id, committee_name) values (1, 'Ganesh Pooja Committee')
  on conflict (id) do nothing;

-- Migration: UPI numbers shown at the bottom of the "Copy This Year's
-- Donations" WhatsApp message, editable from Settings so the committee can
-- update them themselves each year without a code change.
alter table public.ganesh_settings add column if not exists upi_number_1 text not null default '';
alter table public.ganesh_settings add column if not exists upi_number_2 text not null default '';

-- ---------- flats ----------
create table if not exists public.ganesh_flats (
  id text primary key,          -- e.g. 'A001', 'A101'
  label text not null,
  owner text default '',
  tenant text default '',
  created_at timestamptz not null default now()
);

-- ---------- donations ----------
-- kind='cash' -> regular money donation (amount required, mode set)
-- kind='in_kind' -> item sponsorship (Idol, Laddu, etc.) tied to a flat,
--                   amount is an optional estimated value (can be 0)
create table if not exists public.ganesh_donations (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: an old cash-book row sometimes names a donor with no way to
  -- identify their flat (a long-vacated tenant, a name nobody recognizes).
  -- Rather than force a guess, such donations are kept with flat_id = null
  -- and shown as "Unknown / Vacated Tenant" — they still count toward the
  -- year's total collected, but are excluded from any per-flat tracking.
  flat_id text references public.ganesh_flats(id) on delete restrict,
  name text not null default 'Resident',
  kind text not null default 'cash' check (kind in ('cash','in_kind')),
  amount numeric(12,2) not null default 0,
  mode text not null default 'Cash' check (mode in ('Cash','UPI','Bank','')),
  item_description text not null default '',
  date date not null,
  note text default '',
  created_by uuid references public.ganesh_profiles(id),
  collected_by uuid references public.ganesh_profiles(id),
  collected_by_name text not null default '',
  created_at timestamptz not null default now(),
  constraint ganesh_donations_amount_kind_check
    check ((kind = 'cash' and amount > 0) or (kind = 'in_kind' and amount >= 0))
);

-- ---------- pledges ----------
-- A pledge is a promise to donate ("I'll send ₹2000 later") — noted so it
-- isn't forgotten, but NOT counted in Total Collected / Balance until it's
-- actually marked received (which creates a real row in ganesh_donations).
create table if not exists public.ganesh_pledges (
  id uuid primary key default gen_random_uuid(),
  flat_id text not null references public.ganesh_flats(id) on delete restrict,
  name text not null default 'Resident',
  amount numeric(12,2) not null check (amount > 0),
  pledged_date date not null,
  note text default '',
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  fulfilled_donation_id uuid references public.ganesh_donations(id) on delete set null,
  created_by uuid references public.ganesh_profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- expenses ----------
-- bill_url points at a photo of the receipt/bill in the 'receipts' storage
-- bucket (set up below); bill_attached stays as a quick boolean flag kept
-- in sync with whether bill_url is set.
create table if not exists public.ganesh_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  mode text not null default 'Cash' check (mode in ('Cash','UPI','Bank')),
  date date not null,
  note text default '',
  bill_attached boolean not null default false,
  bill_url text,
  created_by uuid references public.ganesh_profiles(id),
  recorded_by uuid references public.ganesh_profiles(id),
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ganesh_expenses add column if not exists bill_url text;

-- Migration for databases created before "Unknown / Vacated Tenant" support —
-- safe to re-run, a no-op once flat_id is already nullable.
alter table public.ganesh_donations alter column flat_id drop not null;

-- ---------- prasadam seva: days + sign-ups ----------
-- Super Admin adds however many days a given year needs (3, 5, 7, ...).
create table if not exists public.ganesh_prasadam_days (
  id uuid primary key default gen_random_uuid(),
  seva_date date not null unique,
  label text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ganesh_prasadam_signups (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.ganesh_prasadam_days(id) on delete restrict,
  session text not null check (session in ('morning','evening')),
  flat_id text not null references public.ganesh_flats(id) on delete restrict,
  name text not null,
  note text default '',
  created_by uuid references public.ganesh_profiles(id),
  created_at timestamptz not null default now()
);

-- Migration: allow a flat's id (e.g. 'A001') to be renamed from the flat
-- edit modal. flat_id foreign keys were originally "on delete restrict"
-- with no "on update" clause, which defaults to "no action" — a rename
-- would fail wherever that flat_id is already referenced. Adding
-- "on update cascade" lets a rename propagate automatically to every
-- linked donation/pledge/seva sign-up. Safe to re-run: drops and
-- recreates each constraint under its default auto-generated name.
alter table public.ganesh_donations drop constraint if exists ganesh_donations_flat_id_fkey;
alter table public.ganesh_donations add constraint ganesh_donations_flat_id_fkey
  foreign key (flat_id) references public.ganesh_flats(id) on delete restrict on update cascade;

alter table public.ganesh_pledges drop constraint if exists ganesh_pledges_flat_id_fkey;
alter table public.ganesh_pledges add constraint ganesh_pledges_flat_id_fkey
  foreign key (flat_id) references public.ganesh_flats(id) on delete restrict on update cascade;

alter table public.ganesh_prasadam_signups drop constraint if exists ganesh_prasadam_signups_flat_id_fkey;
alter table public.ganesh_prasadam_signups add constraint ganesh_prasadam_signups_flat_id_fkey
  foreign key (flat_id) references public.ganesh_flats(id) on delete restrict on update cascade;

-- ---------- fund transfers ("who has how much" cash-in-hand) ----------
create table if not exists public.ganesh_fund_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references public.ganesh_profiles(id),
  from_user_name text not null default '',
  to_user uuid references public.ganesh_profiles(id),
  to_user_name text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  date date not null,
  note text default '',
  created_by uuid references public.ganesh_profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- category budgets (planned spend per category per year) ----------
-- mode='amount' -> a fixed ₹ figure was entered (amount holds the value).
-- mode='percent' -> a % of that year's total collections was entered (pct
-- holds the value, e.g. 20 = 20%); the app computes the ₹ figure live from
-- current donations so it stays current as more money comes in.
create table if not exists public.ganesh_budgets (
  id uuid primary key default gen_random_uuid(),
  year text not null,
  category text not null,
  mode text not null default 'amount' check (mode in ('amount','percent')),
  amount numeric(12,2) not null default 0,
  pct numeric(5,2),
  created_by uuid references public.ganesh_profiles(id),
  created_at timestamptz not null default now(),
  unique (year, category)
);

-- ---------- opening balances (carry cash forward from the previous year) ----------
create table if not exists public.ganesh_opening_balances (
  id uuid primary key default gen_random_uuid(),
  year text not null unique,
  amount numeric(12,2) not null default 0,
  note text default '',
  updated_by uuid references public.ganesh_profiles(id),
  updated_at timestamptz not null default now()
);

-- ---------- activity log (immutable audit trail) ----------
-- Every mutating action in the app writes one row here (who did what, when).
-- No update/delete policy is granted to anyone — not even Super Admin — so
-- once written, an entry can't be edited or removed from inside the app.
create table if not exists public.ganesh_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references public.ganesh_profiles(id),
  actor_name text not null default '',
  action text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Auto-create a profile (role: viewer) whenever someone signs up
-- THROUGH THIS APP specifically -- auth.users is shared by the whole
-- Supabase project, so if any other app also uses this same project
-- for its own sign-ups, this trigger would otherwise create an
-- unwanted ganesh_profiles row (and Users & Roles list entry) for
-- every one of THEIR users too. The app's sign-up call tags its
-- metadata with app:'gpep'; we only auto-create a profile when that
-- tag is present, so unrelated users never show up here at all.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.raw_user_meta_data->>'app' = 'gpep' then
    insert into public.ganesh_profiles (id, email, full_name, role)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'viewer');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Helper: current user's role, without recursive-RLS problems
-- ============================================================
create or replace function public.current_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.ganesh_profiles where id = auth.uid();
$$;

-- ============================================================
-- Public flat picker for the anonymous prasadam seva sign-up page.
-- Returns ONLY flat id + label (never owner/tenant names) to anyone,
-- logged in or not -- so the public link's flat dropdown works
-- without exposing the residents directory or requiring the visitor
-- to be able to read the full ganesh_flats table.
-- ============================================================
create or replace function public.ganesh_public_flat_list()
returns table(id text, label text)
language sql
stable
security definer set search_path = public
as $$
  select id, label from public.ganesh_flats order by id;
$$;
grant execute on function public.ganesh_public_flat_list() to anon, authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.ganesh_profiles enable row level security;
alter table public.ganesh_settings enable row level security;
alter table public.ganesh_flats enable row level security;
alter table public.ganesh_donations enable row level security;
alter table public.ganesh_pledges enable row level security;
alter table public.ganesh_expenses enable row level security;
alter table public.ganesh_prasadam_days enable row level security;
alter table public.ganesh_prasadam_signups enable row level security;
alter table public.ganesh_fund_transfers enable row level security;
alter table public.ganesh_budgets enable row level security;
alter table public.ganesh_opening_balances enable row level security;
alter table public.ganesh_activity_log enable row level security;

-- ---- profiles ----
-- Everyone can see their own row; Super Admin and Treasurer can see
-- everyone (needed to assign roles / pick who a transfer is with).
drop policy if exists ganesh_profiles_select on public.ganesh_profiles;
create policy ganesh_profiles_select on public.ganesh_profiles for select
  using (auth.uid() = id or public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_profiles_update on public.ganesh_profiles;
create policy ganesh_profiles_update on public.ganesh_profiles for update
  using (public.current_role() = 'super_admin');

-- ---- settings ----
drop policy if exists ganesh_settings_select on public.ganesh_settings;
create policy ganesh_settings_select on public.ganesh_settings for select
  using (auth.uid() is not null);

drop policy if exists ganesh_settings_update on public.ganesh_settings;
create policy ganesh_settings_update on public.ganesh_settings for update
  using (public.current_role() = 'super_admin');

-- ---- flats ----
drop policy if exists ganesh_flats_select on public.ganesh_flats;
create policy ganesh_flats_select on public.ganesh_flats for select
  using (auth.uid() is not null);

drop policy if exists ganesh_flats_insert on public.ganesh_flats;
create policy ganesh_flats_insert on public.ganesh_flats for insert
  with check (public.current_role() = 'super_admin');

drop policy if exists ganesh_flats_update on public.ganesh_flats;
create policy ganesh_flats_update on public.ganesh_flats for update
  using (public.current_role() in ('super_admin','donation_collector'));

drop policy if exists ganesh_flats_delete on public.ganesh_flats;
create policy ganesh_flats_delete on public.ganesh_flats for delete
  using (public.current_role() = 'super_admin');

-- ---- donations ----
drop policy if exists ganesh_donations_select on public.ganesh_donations;
create policy ganesh_donations_select on public.ganesh_donations for select
  using (auth.uid() is not null);

-- Insert requires the right role AND that non-admins can only attribute the
-- donation to themselves (collected_by) — prevents a Donation Collector from
-- crediting/hiding entries under someone else's name via a raw API call.
-- Super Admin may attribute to anyone (used when entering on someone's behalf).
drop policy if exists ganesh_donations_insert on public.ganesh_donations;
create policy ganesh_donations_insert on public.ganesh_donations for insert
  with check (
    public.current_role() in ('super_admin','donation_collector')
    and (public.current_role() = 'super_admin' or collected_by = auth.uid())
  );

drop policy if exists ganesh_donations_update on public.ganesh_donations;
create policy ganesh_donations_update on public.ganesh_donations for update
  using (public.current_role() in ('super_admin','donation_collector'));

drop policy if exists ganesh_donations_delete on public.ganesh_donations;
create policy ganesh_donations_delete on public.ganesh_donations for delete
  using (public.current_role() in ('super_admin','donation_collector'));

-- ---- pledges ----
drop policy if exists ganesh_pledges_select on public.ganesh_pledges;
create policy ganesh_pledges_select on public.ganesh_pledges for select
  using (auth.uid() is not null);

drop policy if exists ganesh_pledges_insert on public.ganesh_pledges;
create policy ganesh_pledges_insert on public.ganesh_pledges for insert
  with check (public.current_role() in ('super_admin','donation_collector'));

drop policy if exists ganesh_pledges_update on public.ganesh_pledges;
create policy ganesh_pledges_update on public.ganesh_pledges for update
  using (public.current_role() in ('super_admin','donation_collector'));

drop policy if exists ganesh_pledges_delete on public.ganesh_pledges;
create policy ganesh_pledges_delete on public.ganesh_pledges for delete
  using (public.current_role() in ('super_admin','donation_collector'));

-- ---- expenses ----
drop policy if exists ganesh_expenses_select on public.ganesh_expenses;
create policy ganesh_expenses_select on public.ganesh_expenses for select
  using (auth.uid() is not null);

-- Same self-attribution guard as donations, for recorded_by.
drop policy if exists ganesh_expenses_insert on public.ganesh_expenses;
create policy ganesh_expenses_insert on public.ganesh_expenses for insert
  with check (
    public.current_role() in ('super_admin','treasurer')
    and (public.current_role() = 'super_admin' or recorded_by = auth.uid())
  );

drop policy if exists ganesh_expenses_update on public.ganesh_expenses;
create policy ganesh_expenses_update on public.ganesh_expenses for update
  using (public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_expenses_delete on public.ganesh_expenses;
create policy ganesh_expenses_delete on public.ganesh_expenses for delete
  using (public.current_role() in ('super_admin','treasurer'));

-- ---- prasadam_days: PUBLIC read (no login) so the shareable sign-up ----
-- ---- link works for anonymous visitors; only Super Admin manages ----
drop policy if exists ganesh_prasadam_days_select on public.ganesh_prasadam_days;
create policy ganesh_prasadam_days_select on public.ganesh_prasadam_days for select
  using (true);

drop policy if exists ganesh_prasadam_days_insert on public.ganesh_prasadam_days;
create policy ganesh_prasadam_days_insert on public.ganesh_prasadam_days for insert
  with check (public.current_role() = 'super_admin');

drop policy if exists ganesh_prasadam_days_delete on public.ganesh_prasadam_days;
create policy ganesh_prasadam_days_delete on public.ganesh_prasadam_days for delete
  using (public.current_role() = 'super_admin');

-- ---- prasadam_signups: PUBLIC read AND sign-up (no login) so anyone with ----
-- ---- the shareable link can add their name; only Super Admin edits/deletes ----
-- ---- (corrections). created_by stays null for public/anonymous sign-ups. ----
drop policy if exists ganesh_prasadam_signups_select on public.ganesh_prasadam_signups;
create policy ganesh_prasadam_signups_select on public.ganesh_prasadam_signups for select
  using (true);

drop policy if exists ganesh_prasadam_signups_insert on public.ganesh_prasadam_signups;
create policy ganesh_prasadam_signups_insert on public.ganesh_prasadam_signups for insert
  with check (true);

drop policy if exists ganesh_prasadam_signups_update on public.ganesh_prasadam_signups;
create policy ganesh_prasadam_signups_update on public.ganesh_prasadam_signups for update
  using (public.current_role() = 'super_admin');

drop policy if exists ganesh_prasadam_signups_delete on public.ganesh_prasadam_signups;
create policy ganesh_prasadam_signups_delete on public.ganesh_prasadam_signups for delete
  using (public.current_role() = 'super_admin');

-- ---- fund_transfers: anyone logged in can view (transparency); ----
-- ---- only Super Admin/Treasurer record one; only Super Admin corrects ----
drop policy if exists ganesh_fund_transfers_select on public.ganesh_fund_transfers;
create policy ganesh_fund_transfers_select on public.ganesh_fund_transfers for select
  using (auth.uid() is not null);

drop policy if exists ganesh_fund_transfers_insert on public.ganesh_fund_transfers;
create policy ganesh_fund_transfers_insert on public.ganesh_fund_transfers for insert
  with check (public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_fund_transfers_update on public.ganesh_fund_transfers;
create policy ganesh_fund_transfers_update on public.ganesh_fund_transfers for update
  using (public.current_role() = 'super_admin');

drop policy if exists ganesh_fund_transfers_delete on public.ganesh_fund_transfers;
create policy ganesh_fund_transfers_delete on public.ganesh_fund_transfers for delete
  using (public.current_role() = 'super_admin');

-- ---- budgets: anyone logged in can view; only Super Admin/Treasurer plan ----
drop policy if exists ganesh_budgets_select on public.ganesh_budgets;
create policy ganesh_budgets_select on public.ganesh_budgets for select
  using (auth.uid() is not null);

drop policy if exists ganesh_budgets_insert on public.ganesh_budgets;
create policy ganesh_budgets_insert on public.ganesh_budgets for insert
  with check (public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_budgets_update on public.ganesh_budgets;
create policy ganesh_budgets_update on public.ganesh_budgets for update
  using (public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_budgets_delete on public.ganesh_budgets;
create policy ganesh_budgets_delete on public.ganesh_budgets for delete
  using (public.current_role() in ('super_admin','treasurer'));

-- ---- opening_balances: anyone logged in can view; only Super Admin sets it ----
drop policy if exists ganesh_opening_balances_select on public.ganesh_opening_balances;
create policy ganesh_opening_balances_select on public.ganesh_opening_balances for select
  using (auth.uid() is not null);

drop policy if exists ganesh_opening_balances_insert on public.ganesh_opening_balances;
create policy ganesh_opening_balances_insert on public.ganesh_opening_balances for insert
  with check (public.current_role() = 'super_admin');

drop policy if exists ganesh_opening_balances_update on public.ganesh_opening_balances;
create policy ganesh_opening_balances_update on public.ganesh_opening_balances for update
  using (public.current_role() = 'super_admin');

drop policy if exists ganesh_opening_balances_delete on public.ganesh_opening_balances;
create policy ganesh_opening_balances_delete on public.ganesh_opening_balances for delete
  using (public.current_role() = 'super_admin');

-- ---- activity_log: Super Admin + Treasurer can view; anyone can write their ----
-- ---- own actions (with check pins actor to yourself, no spoofing); nobody ----
-- ---- can update or delete — that's what makes it an audit trail. ----
drop policy if exists ganesh_activity_log_select on public.ganesh_activity_log;
create policy ganesh_activity_log_select on public.ganesh_activity_log for select
  using (public.current_role() in ('super_admin','treasurer'));

drop policy if exists ganesh_activity_log_insert on public.ganesh_activity_log;
create policy ganesh_activity_log_insert on public.ganesh_activity_log for insert
  with check (actor = auth.uid());

-- ============================================================
-- Storage: a 'receipts' bucket for expense bill/receipt photos.
-- Public-read (so the app can just use a plain URL), but only Super
-- Admin/Treasurer can upload or remove files — same people who can
-- add/edit expenses.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects for select
  using (bucket_id = 'receipts');

drop policy if exists receipts_write on storage.objects;
create policy receipts_write on storage.objects for insert
  with check (bucket_id = 'receipts' and public.current_role() in ('super_admin','treasurer'));

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete
  using (bucket_id = 'receipts' and public.current_role() in ('super_admin','treasurer'));

-- ============================================================
-- Realtime: so the app refreshes automatically when someone else
-- adds/edits/deletes a donation, expense, flat, etc. (no manual reload).
-- ============================================================
do $$
declare
  tbl text;
begin
  foreach tbl in array array['ganesh_flats','ganesh_donations','ganesh_pledges','ganesh_expenses','ganesh_settings','ganesh_profiles','ganesh_prasadam_days','ganesh_prasadam_signups','ganesh_fund_transfers','ganesh_budgets','ganesh_opening_balances'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- ============================================================
-- Seed the 72 flats: G+3, 18 flats/floor -> A001-A018, A101-A118,
-- A201-A218, A301-A318 (skip if flats already exist)
-- ============================================================
insert into public.ganesh_flats (id, label, owner, tenant)
select
  'A' || lpad(((f.floor*100) + u.unit)::text, 3, '0'),
  'A' || lpad(((f.floor*100) + u.unit)::text, 3, '0'),
  '',
  ''
from generate_series(0,3) as f(floor)
cross join lateral generate_series(1,18) as u(unit)
where not exists (select 1 from public.ganesh_flats)
on conflict (id) do nothing;

-- ============================================================
-- AFTER running this file:
-- 1. Sign up in the app with your own email/password (lands as 'viewer').
-- 2. Run this once, replacing the email, to make yourself Super Admin:
--
--    update public.ganesh_profiles set role = 'super_admin' where email = 'you@example.com';
--
-- 3. From then on, promote other committee members from Settings → Users
--    inside the app (only visible to Super Admin).
-- ============================================================
