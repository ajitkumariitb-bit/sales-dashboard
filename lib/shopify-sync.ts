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

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

export async function syncShopifyOrders() {
  if (!hasSupabaseConfig()) throw new Error("Supabase is required for Shopify order sync.");

  const storeDomain = normalizeStoreDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";
  const days = Math.min(90, Math.max(1, Number(process.env.SHOPIFY_ORDER_SYNC_DAYS ?? 14) || 14));
  const pageSize = Math.min(100, Math.max(10, Number(process.env.SHOPIFY_ORDER_SYNC_PAGE_SIZE ?? 25) || 25));

  if (!storeDomain) throw new Error("SHOPIFY_STORE_DOMAIN is not set.");
  const accessToken = await getShopifyAccessToken(storeDomain);

  const client = supabaseAdmin();
  const actor = await getConversionUser(client);
  if (!actor) throw new Error("Create at least one admin user before running Shopify sync.");
  const syncStartedAt = new Date().toISOString();
  const createdAtMin = await getOrderSyncStart(client, days);

  let ordersChecked = 0;
  let matched = 0;
  let converted = 0;
  let skipped = 0;
  let hasMore = false;
  let maxOrderCreatedAt = createdAtMin;
  const financialStatuses = ["paid", "partially_paid"] as const;
  const checkedOrderIds = new Set<string>();

  for (const financialStatus of financialStatuses) {
    const cursorKey = `shopify_orders_${financialStatus}_next_url`;
    const syncUrl =
      (await getSyncCursor(client, cursorKey)) ??
      buildOrdersUrl(storeDomain, apiVersion, createdAtMin, financialStatus, pageSize);

    const response = await fetch(syncUrl, {
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
      if (order.created_at && new Date(order.created_at).getTime() > new Date(maxOrderCreatedAt).getTime()) {
        maxOrderCreatedAt = order.created_at;
      }
      const result = await convertMatchingLead(client, order, actor);
      if (result === "converted") {
        matched += 1;
        converted += 1;
      }
      if (result === "matched") matched += 1;
      if (result === "skipped") skipped += 1;
    }

    const nextUrl = nextPageUrl(response.headers.get("link"));
    if (nextUrl) {
      hasMore = true;
      await saveSyncCursor(client, cursorKey, nextUrl);
    } else {
      await clearSyncCursor(client, cursorKey);
    }
  }

  if (!hasMore) {
    await saveSyncCursor(client, "shopify_orders_last_completed_at", maxOrderCreatedAt || syncStartedAt);
  }

  return { ordersChecked, matched, converted, skipped, hasMore };
}

function normalizeStoreDomain(value?: string) {
  return (value ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

async function getShopifyAccessToken(storeDomain: string) {
  const directToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (directToken) return directToken;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Set either SHOPIFY_ADMIN_ACCESS_TOKEN or both SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.");
  }

  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const shop = storeDomain.replace(/\.myshopify\.com$/i, "");
  const response = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Shopify token request failed: ${response.status} ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Shopify token response did not include an access token.");

  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (payload.expires_in ?? 86_399) * 1000;
  return cachedAccessToken;
}

function buildOrdersUrl(
  storeDomain: string,
  apiVersion: string,
  createdAtMin: string,
  financialStatus: "paid" | "partially_paid",
  pageSize: number
) {
  const params = new URLSearchParams({
    status: "any",
    financial_status: financialStatus,
    created_at_min: createdAtMin,
    limit: String(pageSize)
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
    .select("id, lead_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingOrder) {
    const existingLead = await findLeadById(client, existingOrder.lead_id);
    if (existingLead) {
      await closeRelatedCustomerLeads(client, existingLead, existingLead.assigned_to ?? actor.id, new Date().toISOString(), orderId);
      return "matched";
    }
    return "skipped";
  }

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

  await closeRelatedCustomerLeads(client, lead, convertedBy, now, orderId);

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

async function closeRelatedCustomerLeads(
  client: SupabaseClient,
  lead: Lead,
  convertedBy: string,
  now: string,
  orderId: string
) {
  const relatedIds = new Set<string>();
  const phone = lastPhoneDigits(lead.phone);
  const email = lead.email?.trim();

  if (email) {
    const { data, error } = await client
      .from("leads")
      .select("id")
      .neq("id", lead.id)
      .not("current_status", "in", "(converted,lost)")
      .ilike("email", email);
    if (error) throw error;
    for (const row of data ?? []) relatedIds.add(row.id);
  }

  if (phone) {
    const { data, error } = await client
      .from("leads")
      .select("id")
      .neq("id", lead.id)
      .not("current_status", "in", "(converted,lost)")
      .ilike("phone", `%${phone}`);
    if (error) throw error;
    for (const row of data ?? []) relatedIds.add(row.id);
  }

  const ids = [...relatedIds];
  if (ids.length === 0) return;

  const { error: updateError } = await client
    .from("leads")
    .update({
      current_status: "converted",
      next_follow_up_at: null,
      updated_at: now
    })
    .in("id", ids);
  if (updateError) throw updateError;

  const { error: activityError } = await client.from("activities").insert(
    ids.map((leadId) => ({
      lead_id: leadId,
      user_id: convertedBy,
      activity_type: "status_change",
      outcome: "converted",
      note: `Closed because this customer was recovered through Shopify order ${orderId}.`,
      next_follow_up_at: null,
      created_at: now
    }))
  );
  if (activityError) throw activityError;
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

async function findLeadById(client: SupabaseClient, leadId: string) {
  const { data, error } = await client
    .from("leads")
    .select("*, assigned_user:users(*)")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return (data as Lead | null) ?? null;
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

async function getSyncCursor(client: SupabaseClient, key: string) {
  const { data, error } = await client.from("sync_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return typeof data?.value === "string" ? data.value : null;
}

async function saveSyncCursor(client: SupabaseClient, key: string, value: string) {
  const { error } = await client.from("sync_state").upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

async function clearSyncCursor(client: SupabaseClient, key: string) {
  const { error } = await client.from("sync_state").delete().eq("key", key);
  if (error) throw error;
}

async function getOrderSyncStart(client: SupabaseClient, fallbackDays: number) {
  const lastCompletedAt = await getSyncCursor(client, "shopify_orders_last_completed_at");
  if (lastCompletedAt) {
    return new Date(new Date(lastCompletedAt).getTime() - 10 * 60 * 1000).toISOString();
  }

  const { data: latestOrder, error: latestOrderError } = await client
    .from("orders_recovered")
    .select("converted_at")
    .order("converted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestOrderError) throw latestOrderError;
  if (latestOrder?.converted_at) {
    return new Date(new Date(String(latestOrder.converted_at)).getTime() - 10 * 60 * 1000).toISOString();
  }

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
