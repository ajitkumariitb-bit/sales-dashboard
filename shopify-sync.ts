import { hasSupabaseConfig, supabaseAdmin } from "./supabase";
import type { AppUser, Lead } from "./types";

type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  processed_at?: string | null;
  financial_status?: string | null;
  total_price?: string | null;
  current_total_price?: string | null;
  customer?: {
    email?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: {
    phone?: string | null;
  } | null;
  shipping_address?: {
    phone?: string | null;
  } | null;
};

type ShopifyOrdersResponse = {
  orders?: ShopifyOrder[];
};

type SupabaseClient = ReturnType<typeof supabaseAdmin>;

export async function syncShopifyOrders() {
  if (!hasSupabaseConfig()) throw new Error("Supabase is required for Shopify order sync.");

  const storeDomain = normalizeStoreDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";
  const days = Math.min(90, Math.max(1, Number(process.env.SHOPIFY_ORDER_SYNC_DAYS ?? 14) || 14));

  if (!storeDomain) throw new Error("SHOPIFY_STORE_DOMAIN is not set.");
  if (!accessToken) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is not set.");

  const client = supabaseAdmin();
  const actor = await getConversionUser(client);
  if (!actor) throw new Error("Create at least one admin user before running Shopify sync.");
  const createdAtMin = await getOrderSyncStart(client, days);

  let ordersChecked = 0;
  let matched = 0;
  let converted = 0;
  let skipped = 0;
  const firstPageUrls = [
    buildOrdersUrl(storeDomain, apiVersion, createdAtMin, "paid"),
    buildOrdersUrl(storeDomain, apiVersion, createdAtMin, "partially_paid")
  ];
  const checkedOrderIds = new Set<string>();

  for (const firstPageUrl of firstPageUrls) {
    let nextUrl: string | null = firstPageUrl;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Shopify sync failed: ${response.status} ${detail.slice(0, 200)}`);
      }

      const payload = (await response.json()) as ShopifyOrdersResponse;
      for (const order of payload.orders ?? []) {
        const orderKey = String(order.id);
        if (checkedOrderIds.has(orderKey)) continue;
        checkedOrderIds.add(orderKey);
        ordersChecked += 1;
        const result = await convertMatchingLead(client, order, actor);
        if (result === "converted") {
          matched += 1;
          converted += 1;
        }
        if (result === "matched") matched += 1;
        if (result === "skipped") skipped += 1;
      }

      nextUrl = nextPageUrl(response.headers.get("link"));
    }
  }

  return { ordersChecked, matched, converted, skipped };
}

function normalizeStoreDomain(value?: string) {
  return (value ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

function buildOrdersUrl(storeDomain: string, apiVersion: string, createdAtMin: string, financialStatus: "paid" | "partially_paid") {
  const params = new URLSearchParams({
    status: "any",
    financial_status: financialStatus,
    created_at_min: createdAtMin,
    limit: "250"
  });
  return `https://${storeDomain}/admin/api/${apiVersion}/orders.json?${params.toString()}`;
}

function nextPageUrl(linkHeader: string | null) {
  if (!linkHeader) return null;
  const nextLink = linkHeader.split(",").find((part) => part.includes('rel="next"'));
  const match = nextLink?.match(/<([^>]+)>/);
  return match?.[1] ?? null;
}

async function convertMatchingLead(client: SupabaseClient, order: ShopifyOrder, actor: AppUser) {
  const orderId = String(order.name || order.id);
  const { data: existingOrder, error: existingError } = await client
    .from("orders_recovered")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingOrder) return "skipped";

  const lead = await findLeadForOrder(client, order);
  if (!lead) return "skipped";

  const revenue = Number(order.current_total_price ?? order.total_price ?? 0);
  if (!Number.isFinite(revenue) || revenue <= 0) return "skipped";

  const convertedBy = lead.assigned_to ?? actor.id;
  const convertedAt = order.processed_at || order.created_at || new Date().toISOString();
  const now = new Date().toISOString();
  const alreadyConverted = lead.current_status === "converted";

  const { error: insertError } = await client.from("orders_recovered").insert({
    lead_id: lead.id,
    order_id: orderId,
    recovered_revenue: revenue,
      converted_by: convertedBy,
      converted_at: convertedAt
  });
  if (insertError) throw insertError;

  if (!alreadyConverted) {
    const { error: leadError } = await client
      .from("leads")
      .update({
        current_status: "converted",
        next_follow_up_at: null,
        updated_at: now
      })
      .eq("id", lead.id);
    if (leadError) throw leadError;
  }

  await client.from("activities").insert({
    lead_id: lead.id,
    user_id: convertedBy,
    activity_type: "status_change",
    outcome: "converted",
    note: alreadyConverted
      ? `Added Shopify order ${orderId} to this recovered customer.`
      : `Auto matched Shopify order ${orderId}.`,
    next_follow_up_at: null,
    created_at: now
  });

  return alreadyConverted ? "matched" : "converted";
}

async function findLeadForOrder(client: SupabaseClient, order: ShopifyOrder) {
  const leadsById = new Map<string, Lead>();
  const email = (order.email || order.customer?.email || "").trim();
  const phones = orderPhones(order);

  if (email) {
    const { data, error } = await client
      .from("leads")
      .select("*, assigned_user:users(*)")
      .ilike("email", email)
      .limit(10);
    if (error) throw error;
    for (const lead of (data ?? []) as Lead[]) leadsById.set(lead.id, lead);
  }

  for (const phone of phones) {
    const { data, error } = await client
      .from("leads")
      .select("*, assigned_user:users(*)")
      .ilike("phone", `%${phone}`)
      .limit(10);
    if (error) throw error;
    for (const lead of (data ?? []) as Lead[]) leadsById.set(lead.id, lead);
  }

  return [...leadsById.values()].sort((a, b) => {
    if (a.current_status === "converted" && b.current_status !== "converted") return -1;
    if (b.current_status === "converted" && a.current_status !== "converted") return 1;
    if (b.lead_score !== a.lead_score) return b.lead_score - a.lead_score;
    return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
  })[0] ?? null;
}

function orderPhones(order: ShopifyOrder) {
  const values = [
    order.phone,
    order.customer?.phone,
    order.billing_address?.phone,
    order.shipping_address?.phone
  ];
  return [...new Set(values.map(lastPhoneDigits).filter(Boolean))] as string[];
}

function lastPhoneDigits(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.slice(-10);
}

async function getConversionUser(client: SupabaseClient) {
  const { data: admin, error: adminError } = await client
    .from("users")
    .select("*")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (adminError) throw adminError;
  if (admin) return admin as AppUser;

  const { data: user, error: userError } = await client.from("users").select("*").limit(1).maybeSingle();
  if (userError) throw userError;
  return (user as AppUser | null) ?? null;
}

async function getOrderSyncStart(client: SupabaseClient, fallbackDays: number) {
  const fallback = new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("leads")
    .select("first_seen_at")
    .order("first_seen_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return String(data?.first_seen_at ?? fallback);
}
