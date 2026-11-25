-- Migrasi 03: rekening investasi (obligasi, pasar uang, kripto).
-- Jalankan SETELAH migrasi 02. Aman dijalankan ulang; data lama tidak berubah.

-- 1) Jenis rekening baru
alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check
  check (kind in ('bank', 'ewallet', 'cash', 'other', 'bond', 'mmf', 'crypto', 'invest'));

-- 2) Nilai pasar (diisi manual untuk obligasi / pasar uang / lainnya)
alter table public.accounts
  add column if not exists market_value     bigint,
  add column if not exists value_updated_at timestamptz,
-- 3) Kripto: koin apa & jumlah koin sebelum mulai dicatat
  add column if not exists coin             text,
  add column if not exists opening_units    numeric not null default 0;

alter table public.accounts drop constraint if exists accounts_units_check;
alter table public.accounts add constraint accounts_units_check check (opening_units >= 0);

-- 4) Jumlah koin yang berpindah dalam sebuah transfer (beli / jual kripto)
alter table public.transactions add column if not exists units numeric;
alter table public.transactions drop constraint if exists transactions_units_check;
alter table public.transactions add constraint transactions_units_check check (units is null or units >= 0);
