alter table public.leads
add column if not exists buyer_type text;

alter table public.users
add column if not exists password_hash text;

update public.users
set password_hash = 'leadrecovery:51e2680448382ddd4f5183a390b87250c462860bcdc5155ebd18cf22f381c9b3'
where password_hash is null;

alter type activity_outcome add value if not exists 'message_sent';
alter type activity_outcome add value if not exists 'message_delivered';
alter type activity_outcome add value if not exists 'message_read';
alter type activity_outcome add value if not exists 'customer_replied';
alter type activity_outcome add value if not exists 'callback_requested';
