-- Migrasi 04: fee / biaya transfer.
-- Jalankan SETELAH migrasi 03. Aman dijalankan ulang; data lama tidak berubah.

alter table public.transactions add column if not exists fee bigint;
alter table public.transactions drop constraint if exists transactions_fee_check;
alter table public.transactions add constraint transactions_fee_check check (fee is null or fee >= 0);

-- Beri tahu API Supabase bahwa ada kolom baru
notify pgrst, 'reload schema';
