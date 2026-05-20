insert into public.users (id, name, email, role) values
  ('00000000-0000-0000-0000-000000000001', 'Aditi Admin', 'admin@example.com', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'Rahul Sales', 'rahul@example.com', 'salesperson'),
  ('00000000-0000-0000-0000-000000000003', 'Meera Sales', 'meera@example.com', 'salesperson')
on conflict (email) do nothing;

insert into public.leads (
  source, raw_stage, customer_name, phone, email, city, state, product_names, product_url,
  checkout_url, recovery_url, cart_value, first_seen_at, assigned_to, current_status,
  total_call_attempts, total_whatsapp_attempts, total_touch_count
) values
  ('google_sheet', 'INIT - checkout opened', 'Neha Kapoor', '+919810000001', 'neha@example.com', 'Delhi', 'Delhi', 'Vitamin C Serum', 'https://brand.example/products/vitamin-c-serum', 'https://checkout.shopify.com/init-001', 'https://brand.example/cart/recover/init-001', 899, now() - interval '70 minutes', '00000000-0000-0000-0000-000000000002', 'new', 0, 0, 0),
  ('google_sheet', 'Phone received', 'Arjun Rao', '+919810000002', 'arjun@example.com', 'Bengaluru', 'Karnataka', 'Protein Bar Trial Pack', 'https://brand.example/products/protein-bars', 'https://checkout.shopify.com/phone-002', 'https://brand.example/cart/recover/phone-002', 499, now() - interval '220 minutes', '00000000-0000-0000-0000-000000000003', 'contacted', 1, 1, 2),
  ('google_sheet', 'OTP verified / customer authenticated', 'Priya Menon', '+919810000003', 'priya@example.com', 'Kochi', 'Kerala', 'Hair Growth Kit', 'https://brand.example/products/hair-growth-kit', 'https://checkout.shopify.com/otp-003', 'https://brand.example/cart/recover/otp-003', 2499, now() - interval '390 minutes', '00000000-0000-0000-0000-000000000002', 'new', 0, 1, 1),
  ('google_sheet', 'Address screen reached', 'Kabir Sharma', '+919810000004', 'kabir@example.com', 'Mumbai', 'Maharashtra', 'Sneaker Care Bundle', 'https://brand.example/products/sneaker-care', 'https://checkout.shopify.com/address-004', 'https://brand.example/cart/recover/address-004', 1799, now() - interval '130 minutes', '00000000-0000-0000-0000-000000000003', 'follow_up', 2, 1, 3),
  ('google_sheet', 'Order screen', 'Sara Ali', '+919810000005', 'sara@example.com', 'Hyderabad', 'Telangana', 'Premium Skincare Combo', 'https://brand.example/products/skincare-combo', 'https://checkout.shopify.com/order-005', 'https://brand.example/cart/recover/order-005', 3499, now() - interval '115 minutes', '00000000-0000-0000-0000-000000000002', 'new', 0, 0, 0),
  ('google_sheet', 'Payment initiated - Razorpay opened', 'Dev Patel', '+919810000006', 'dev@example.com', 'Ahmedabad', 'Gujarat', 'Wireless Massage Gun', 'https://brand.example/products/massage-gun', 'https://checkout.shopify.com/payment-006', 'https://brand.example/cart/recover/payment-006', 5999, now() - interval '25 minutes', '00000000-0000-0000-0000-000000000003', 'new', 0, 0, 0),
  ('shiprocket_csv', 'Browser lead', 'Isha Jain', '+919810000007', null, 'Jaipur', 'Rajasthan', 'Copper Bottle', 'https://brand.example/products/copper-bottle', null, null, null, now() - interval '55 minutes', '00000000-0000-0000-0000-000000000002', 'new', 0, 1, 1)
on conflict do nothing;

insert into public.activities (lead_id, user_id, activity_type, outcome, note, next_follow_up_at)
select l.id, '00000000-0000-0000-0000-000000000003', 'call', 'not_connected', 'No answer. WhatsApp recovery link sent.', now() + interval '90 minutes'
from public.leads l
where l.phone = '+919810000002'
on conflict do nothing;

insert into public.followup_tasks (lead_id, assigned_to, due_at, status, followup_number)
select l.id, l.assigned_to, now() - interval '20 minutes', 'missed', 2
from public.leads l
where l.phone = '+919810000004'
on conflict do nothing;
