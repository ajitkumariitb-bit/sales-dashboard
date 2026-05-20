create unique index if not exists leads_phone_checkout_pair_unique
on public.leads (phone, checkout_url);
