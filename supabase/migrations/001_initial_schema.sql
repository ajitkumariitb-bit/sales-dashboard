create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum ('admin', 'salesperson');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lead_source as enum ('google_sheet', 'shiprocket_csv', 'manual', 'shopify_api');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type normalized_stage as enum ('INIT', 'Phone received', 'OTP verified', 'Address screen', 'Order screen', 'Payment initiated');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lead_priority as enum ('P1 Hot', 'P2 Warm', 'P3 Nurture');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lead_status as enum ('new', 'contacted', 'connected', 'follow_up', 'converted', 'lost', 'not_reachable');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type activity_type as enum ('call', 'whatsapp', 'note', 'status_change');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type activity_outcome as enum (
    'connected',
    'not_connected',
    'switched_off',
    'interested',
    'not_interested',
    'price_issue',
    'payment_issue',
    'delivery_issue',
    'wants_discount',
    'converted',
    'lost'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type followup_status as enum ('pending', 'completed', 'missed');
exception when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  role user_role not null default 'salesperson',
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source lead_source not null,
  raw_stage text,
  normalized_stage normalized_stage not null default 'INIT',
  lead_score integer not null default 20 check (lead_score between 0 and 100),
  priority lead_priority not null default 'P3 Nurture',
  customer_name text,
  phone text not null,
  email text,
  city text,
  state text,
  product_names text,
  product_url text,
  checkout_url text,
  recovery_url text,
  cart_value numeric(12,2),
  first_seen_at timestamptz not null default now(),
  assigned_to uuid references public.users(id) on delete set null,
  current_status lead_status not null default 'new',
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  total_call_attempts integer not null default 0,
  total_whatsapp_attempts integer not null default 0,
  total_touch_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_phone_checkout_unique
on public.leads (phone, coalesce(checkout_url, ''));

create index if not exists leads_priority_idx on public.leads(priority);
create index if not exists leads_stage_idx on public.leads(normalized_stage);
create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists leads_next_follow_up_idx on public.leads(next_follow_up_at);
create index if not exists leads_source_idx on public.leads(source);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  activity_type activity_type not null,
  outcome activity_outcome,
  note text not null check (length(trim(note)) > 0),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists activities_lead_id_idx on public.activities(lead_id);
create index if not exists activities_user_id_idx on public.activities(user_id);
create index if not exists activities_created_at_idx on public.activities(created_at desc);

create table if not exists public.orders_recovered (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  order_id text not null,
  recovered_revenue numeric(12,2) not null check (recovered_revenue > 0),
  converted_by uuid not null references public.users(id) on delete restrict,
  converted_at timestamptz not null default now()
);

create index if not exists orders_recovered_lead_id_idx on public.orders_recovered(lead_id);
create index if not exists orders_recovered_converted_by_idx on public.orders_recovered(converted_by);

create table if not exists public.followup_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_to uuid not null references public.users(id) on delete cascade,
  due_at timestamptz not null,
  status followup_status not null default 'pending',
  followup_number integer not null check (followup_number between 1 and 5),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists followup_tasks_due_at_idx on public.followup_tasks(due_at);
create index if not exists followup_tasks_assigned_to_idx on public.followup_tasks(assigned_to);
create index if not exists followup_tasks_status_idx on public.followup_tasks(status);

create or replace function public.normalize_checkout_stage(raw text)
returns normalized_stage
language sql
immutable
as $$
  select case
    when raw ilike '%Payment initiated%' then 'Payment initiated'::normalized_stage
    when raw ilike '%Order screen%' then 'Order screen'::normalized_stage
    when raw ilike '%Address screen%' then 'Address screen'::normalized_stage
    when raw ilike '%OTP verified%' then 'OTP verified'::normalized_stage
    when raw ilike '%Phone received%' then 'Phone received'::normalized_stage
    when raw ilike '%INIT%' then 'INIT'::normalized_stage
    else 'INIT'::normalized_stage
  end;
$$;

create or replace function public.stage_score(stage normalized_stage)
returns integer
language sql
immutable
as $$
  select case stage
    when 'Payment initiated' then 100
    when 'Order screen' then 90
    when 'Address screen' then 75
    when 'OTP verified' then 60
    when 'Phone received' then 40
    else 20
  end;
$$;

create or replace function public.priority_from_score(score integer)
returns lead_priority
language sql
immutable
as $$
  select case
    when score >= 90 then 'P1 Hot'::lead_priority
    when score >= 60 then 'P2 Warm'::lead_priority
    else 'P3 Nurture'::lead_priority
  end;
$$;

create or replace function public.set_lead_scoring()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'shiprocket_csv' then
    new.priority := 'P3 Nurture';
    if new.lead_score is null or new.lead_score < 35 then
      new.lead_score := 35;
    end if;
  else
    new.normalized_stage := public.normalize_checkout_stage(new.raw_stage);
    new.lead_score := public.stage_score(new.normalized_stage);
    new.priority := public.priority_from_score(new.lead_score);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_scoring_trigger on public.leads;
create trigger leads_scoring_trigger
before insert or update of raw_stage, source, lead_score on public.leads
for each row execute function public.set_lead_scoring();

create or replace function public.mark_missed_followups()
returns void
language sql
as $$
  update public.followup_tasks
  set status = 'missed'
  where status = 'pending'
    and due_at < now();
$$;
