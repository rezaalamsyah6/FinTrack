-- Migrasi 02: banyak rekening + transfer antar rekening.
-- Jalankan sekali di Supabase: SQL Editor → New query → tempel → Run.
-- Aman dijalankan ulang. Data transaksi lama TIDAK hilang
-- (dipindahkan ke rekening bernama "Rekening Utama").

-- 1) Tabel rekening
create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  kind             text not null default 'bank' check (kind in ('bank', 'ewallet', 'cash', 'other')),
  opening_balance  bigint not null default 0,
  created_at       timestamptz not null default now()
);

alter table public.accounts enable row level security;
grant select, insert, update, delete on public.accounts to authenticated;

drop policy if exists "rekening milik sendiri" on public.accounts;
create policy "rekening milik sendiri" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Kolom rekening di transaksi
alter table public.transactions
  add column if not exists account_id    uuid references public.accounts (id) on delete cascade,
  add column if not exists to_account_id uuid references public.accounts (id) on delete cascade;

create index if not exists transactions_account_idx    on public.transactions (account_id);
create index if not exists transactions_to_account_idx on public.transactions (to_account_id);

-- 3) Jenis transaksi baru: transfer
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('in', 'out', 'transfer'));

alter table public.transactions drop constraint if exists transactions_transfer_check;
alter table public.transactions add constraint transactions_transfer_check
  check ((type = 'transfer') = (to_account_id is not null) and to_account_id is distinct from account_id);

-- 4) Pindahkan transaksi lama ke "Rekening Utama"
insert into public.accounts (user_id, name, kind)
select distinct t.user_id, 'Rekening Utama', 'bank'
from public.transactions t
where t.account_id is null
  and not exists (select 1 from public.accounts a where a.user_id = t.user_id and a.name = 'Rekening Utama');

update public.transactions t
set account_id = a.id
from public.accounts a
where t.account_id is null and a.user_id = t.user_id and a.name = 'Rekening Utama';

alter table public.transactions alter column account_id set not null;

-- 5) Transaksi hanya boleh memakai rekening milik sendiri
drop policy if exists "tambah milik sendiri" on public.transactions;
drop policy if exists "ubah milik sendiri"   on public.transactions;

create policy "tambah milik sendiri" on public.transactions for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())
  and (to_account_id is null or exists (select 1 from public.accounts a where a.id = to_account_id and a.user_id = auth.uid()))
);
create policy "ubah milik sendiri" on public.transactions for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id
  and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())
  and (to_account_id is null or exists (select 1 from public.accounts a where a.id = to_account_id and a.user_id = auth.uid()))
);
