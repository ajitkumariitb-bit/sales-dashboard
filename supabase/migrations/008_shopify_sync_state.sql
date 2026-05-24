create table if not exists public.sync_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
