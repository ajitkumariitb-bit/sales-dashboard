create or replace function public.normalize_checkout_stage(raw text)
returns normalized_stage
language sql
immutable
as $$
  select case
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%payment%' then 'Payment initiated'::normalized_stage
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%order%' then 'Order screen'::normalized_stage
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%address%' then 'Address screen'::normalized_stage
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%otp%' then 'OTP verified'::normalized_stage
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%phone%'
      or regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%mobile%' then 'Phone received'::normalized_stage
    when regexp_replace(lower(coalesce(raw, '')), '[_-]+', ' ', 'g') like '%init%' then 'INIT'::normalized_stage
    else 'INIT'::normalized_stage
  end;
$$;

update public.leads
set
  normalized_stage = public.normalize_checkout_stage(raw_stage),
  lead_score = public.stage_score(public.normalize_checkout_stage(raw_stage)),
  priority = public.priority_from_score(public.stage_score(public.normalize_checkout_stage(raw_stage))),
  updated_at = now()
where source = 'google_sheet';
