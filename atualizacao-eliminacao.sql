alter table public.notes
add column if not exists deleted_at timestamptz;
