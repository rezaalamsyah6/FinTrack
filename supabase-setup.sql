-- Jalankan sekali di Supabase: SQL Editor → New query → tempel → Run.

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('in', 'out')),
  amount      bigint not null check (amount > 0),
  category    text not null,
  date        date not null,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

-- Izinkan pengguna yang sudah login memakai tabel ini lewat aplikasi
-- (pengunjung yang belum login / "anon" sengaja TIDAK diberi izin).
grant select, insert, update, delete on public.transactions to authenticated;

-- Keamanan: setiap pengguna hanya bisa melihat & mengubah datanya sendiri.
alter table public.transactions enable row level security;

drop policy if exists "lihat milik sendiri"  on public.transactions;
drop policy if exists "tambah milik sendiri" on public.transactions;
drop policy if exists "ubah milik sendiri"   on public.transactions;
drop policy if exists "hapus milik sendiri"  on public.transactions;

create policy "lihat milik sendiri"  on public.transactions for select using (auth.uid() = user_id);
create policy "tambah milik sendiri" on public.transactions for insert with check (auth.uid() = user_id);
create policy "ubah milik sendiri"   on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hapus milik sendiri"  on public.transactions for delete using (auth.uid() = user_id);
