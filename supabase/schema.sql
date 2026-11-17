-- Expense Calculator: Supabase schema
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Every table is locked down with Row Level Security: a signed-in user can only
-- read and write their own rows.

-- ---------- Profiles (settings and budget, one row per user) ----------
create table if not exists public.profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  name              text,
  month_start       smallint not null default 1 check (month_start between 1 and 28),
  default_account   text,
  theme             text not null default 'light' check (theme in ('light','dark','system')),
  budget_total      numeric(14,2) not null default 30000,
  budget_categories jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- Accounts: banks, wallets, cash, credit cards ----------
create table if not exists public.accounts (
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id              text not null,
  name            text not null,
  type            text not null check (type in ('bank','wallet','cash','card')),
  opening_balance numeric(14,2) not null default 0,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------- Commitments: EMIs, rent, bills, subscriptions ----------
create table if not exists public.commitments (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                text not null,
  name              text not null,
  type              text not null check (type in ('EMI','Rent','Bill','Subscription','Insurance','Other')),
  amount            numeric(14,2) not null check (amount > 0),
  variable          boolean not null default false,
  category          text not null default 'other',
  account_id        text,
  due_day           smallint not null check (due_day between 1 and 28),
  total_instalments integer,
  instalments_paid  integer not null default 0,
  lender            text,
  remind_days       smallint not null default 2,
  paid_dates        jsonb not null default '[]'::jsonb,   -- due dates already paid, e.g. ["2026-11-05"]
  skipped_dates     jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------- Transactions: expense, income, transfer, lend, borrow, repayments, corrections ----------
create table if not exists public.transactions (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id             text not null,
  type           text not null check (type in ('exp','inc','tr','lend','borrow','repayIn','repayOut','adj')),
  amount         numeric(14,2) not null,
  account_id     text not null,
  to_account_id  text,               -- transfers only
  category       text,               -- expense category or income source
  person         text,               -- lend / borrow / gift from
  note           text,
  date           date not null default current_date,
  commitment_id  text,               -- set when paying an EMI or bill
  linked_id      text,               -- transfer fee linked to its transfer
  attachments    jsonb not null default '[]'::jsonb,  -- [{id,label,name,pdf,path}]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists transactions_user_date on public.transactions (user_id, date desc);

-- ---------- Row Level Security ----------
alter table public.profiles     enable row level security;
alter table public.accounts     enable row level security;
alter table public.commitments  enable row level security;
alter table public.transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','commitments','transactions'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- New user: create profile and a starting Cash account ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, name, default_account)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'cash')
  on conflict (user_id) do nothing;
  insert into public.accounts (user_id, id, name, type, opening_balance)
  values (new.id, 'cash', 'Cash', 'cash', 0)
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Storage for bills and payment slips (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','image/svg+xml','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "own files read"   on storage.objects;
drop policy if exists "own files write"  on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;
create policy "own files read"   on storage.objects for select to authenticated using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files write"  on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files update" on storage.objects for update to authenticated using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files delete" on storage.objects for delete to authenticated using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
