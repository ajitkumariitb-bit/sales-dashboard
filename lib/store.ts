import { cookies } from "next/headers";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { hashPassword } from "./auth";
import { demoActivities, demoFollowups, demoLeads, demoRecoveredOrders, demoUsers } from "./demo-data";
import { endOfToday, isPast, isToday, startOfToday } from "./date";
import { scoreBrowserLead, scoreFromStage, isHigherStage, compareLeadIntent } from "./stage";
import { hasSupabaseConfig, supabaseAdmin } from "./supabase";
import type {
  Activity,
  ActivityOutcome,
  ActivityType,
  AppUser,
  FollowupTask,
  ImportLeadInput,
  Lead,
  LeadFilters,
  LeadStatus,
  RecoveredOrder,
  UserRole
} from "./types";

const users = demoUsers;
const leads = demoLeads;
const activities = demoActivities;
const followups = demoFollowups;
const recoveredOrders = demoRecoveredOrders;

const localDataPath = join(process.cwd(), ".local-data", "db.json");

type LocalDb = {
  users: AppUser[];
  leads: Lead[];
  activities: Activity[];
  followups: FollowupTask[];
  recoveredOrders: RecoveredOrder[];
};

function syncLocalDbFromDisk() {
  if (hasSupabaseConfig() || !existsSync(localDataPath)) return;
  const data = JSON.parse(readFileSync(localDataPath, "utf8")) as Partial<LocalDb>;
  users.splice(0, users.length, ...(data.users ?? demoUsers));
  leads.splice(0, leads.length, ...(data.leads ?? demoLeads));
  activities.splice(0, activities.length, ...(data.activities ?? demoActivities));
  followups.splice(0, followups.length, ...(data.followups ?? demoFollowups));
  recoveredOrders.splice(0, recoveredOrders.length, ...(data.recoveredOrders ?? demoRecoveredOrders));
}

function saveLocalDbToDisk() {
  if (hasSupabaseConfig()) return;
  mkdirSync(join(process.cwd(), ".local-data"), { recursive: true });
  writeFileSync(
    localDataPath,
    JSON.stringify({ users, leads, activities, followups, recoveredOrders } satisfies LocalDb, null, 2)
  );
}

function withAssignedUser(lead: Lead): Lead {
  return {
    ...lead,
    assigned_user: users.find((user) => user.id === lead.assigned_to) ?? null
  };
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getCurrentUser(): Promise<AppUser> {
  const user = await getOptionalCurrentUser();
  if (!user) throw new Error("Not authenticated.");
  return user;
}

export async function getOptionalCurrentUser(): Promise<AppUser | null> {
  const jar = await cookies();
  const userId = jar.get("lrcrm_user_id")?.value;
  const availableUsers = await getUsers();
  const user = availableUsers.find((item) => item.id === userId);
  if (user) return user;
  if (!hasSupabaseConfig()) return availableUsers[0] ?? users[0] ?? null;
  return null;
}

export async function getUsers(): Promise<AppUser[]> {
  if (hasSupabaseConfig()) {
    const { data, error } = await supabaseAdmin().from("users").select("*").order("name");
    if (error) throw error;
    return data;
  }
  syncLocalDbFromDisk();
  return users;
}

export async function createCrmUser(input: {
  name: string;
  email: string;
  role: UserRole;
  password: string;
}) {
  if (!input.name.trim()) throw new Error("Name is required.");
  if (!input.email.trim()) throw new Error("Email is required.");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters.");
  const now = new Date().toISOString();

  if (hasSupabaseConfig()) {
    const { data, error } = await supabaseAdmin()
      .from("users")
      .insert({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        password_hash: hashPassword(input.password),
        created_at: now
      })
      .select("id,name,email,role,created_at")
      .single();
    if (error) throw error;
    return data as AppUser;
  }

  const user: AppUser = {
    id: nextId("user"),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    created_at: now
  };
  users.push(user);
  saveLocalDbToDisk();
  return user;
}

export async function assignLead(leadId: string, assignedTo: string | null) {
  const now = new Date().toISOString();
  if (hasSupabaseConfig()) {
    const { error } = await supabaseAdmin()
      .from("leads")
      .update({ assigned_to: assignedTo, updated_at: now })
      .eq("id", leadId);
    if (error) throw error;
    return;
  }

  syncLocalDbFromDisk();
  const index = leads.findIndex((lead) => lead.id === leadId);
  if (index >= 0) {
    leads[index] = { ...leads[index], assigned_to: assignedTo, updated_at: now };
    saveLocalDbToDisk();
  }
}

export async function bulkAssignLeads(input: {
  assigned_to: string;
  priority?: string;
  normalized_stage?: string;
  limit?: number;
}) {
  const limit = Math.min(1000, Math.max(1, input.limit ?? 100));
  const now = new Date().toISOString();

  if (hasSupabaseConfig()) {
    let query = supabaseAdmin().from("leads").select("id").is("assigned_to", null);
    if (input.priority) query = query.eq("priority", input.priority);
    if (input.normalized_stage) query = query.eq("normalized_stage", input.normalized_stage);
    const { data, error } = await query.order("lead_score", { ascending: false }).limit(limit);
    if (error) throw error;
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length === 0) return { assigned: 0 };
    const { error: updateError } = await supabaseAdmin()
      .from("leads")
      .update({ assigned_to: input.assigned_to, updated_at: now })
      .in("id", ids);
    if (updateError) throw updateError;
    return { assigned: ids.length };
  }

  syncLocalDbFromDisk();
  let assigned = 0;
  for (const lead of sortLeads(leads)) {
    if (assigned >= limit) break;
    if (lead.assigned_to) continue;
    if (input.priority && lead.priority !== input.priority) continue;
    if (input.normalized_stage && lead.normalized_stage !== input.normalized_stage) continue;
    lead.assigned_to = input.assigned_to;
    lead.updated_at = now;
    assigned += 1;
  }
  saveLocalDbToDisk();
  return { assigned };
}

export async function createManualLead(input: {
  customer_name?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  buyer_type?: string | null;
  product_names?: string | null;
  product_url?: string | null;
  checkout_url?: string | null;
  cart_value?: number | null;
  raw_stage?: string | null;
  assigned_to?: string | null;
}) {
  if (!input.phone.trim()) throw new Error("Phone is required.");
  return upsertImportedLead({
    source: "manual",
    source_detail: "Manual / Instagram",
    raw_stage: input.raw_stage || "Phone received",
    customer_name: input.customer_name || null,
    phone: input.phone,
    email: input.email || null,
    city: input.city || null,
    state: input.state || null,
    buyer_type: input.buyer_type || null,
    product_names: input.product_names || null,
    product_url: input.product_url || null,
    checkout_url: input.checkout_url || null,
    cart_value: input.cart_value ?? null,
    assigned_to: input.assigned_to || null,
    first_seen_at: new Date().toISOString()
  });
}

export async function getLeads(filters: LeadFilters = {}, viewer?: AppUser): Promise<Lead[]> {
  const result = await getLeadsResult(filters, viewer, { all: true });
  return result.leads;
}

export async function getLeadsResult(
  filters: LeadFilters = {},
  viewer?: AppUser,
  options: { page?: number; pageSize?: number; all?: boolean } = {}
): Promise<{ leads: Lead[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(250, Math.max(10, options.pageSize ?? 100));
  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    let query = client.from("leads").select("*, assigned_user:users(*)");
    let countQuery = client.from("leads").select("id", { count: "exact", head: true });

    if (viewer?.role === "salesperson") {
      query = query.eq("assigned_to", viewer.id).neq("normalized_stage", "INIT");
      countQuery = countQuery.eq("assigned_to", viewer.id).neq("normalized_stage", "INIT");
    }
    if (filters.priority) {
      query = query.eq("priority", filters.priority);
      countQuery = countQuery.eq("priority", filters.priority);
    }
    if (filters.normalizedStage) {
      query = query.eq("normalized_stage", filters.normalizedStage);
      countQuery = countQuery.eq("normalized_stage", filters.normalizedStage);
    }
    if (filters.source) {
      query = query.eq("source", filters.source);
      countQuery = countQuery.eq("source", filters.source);
    }
    if (filters.assignedTo) {
      query = query.eq("assigned_to", filters.assignedTo);
      countQuery = countQuery.eq("assigned_to", filters.assignedTo);
    }
    if (filters.status) {
      query = query.eq("current_status", filters.status);
      countQuery = countQuery.eq("current_status", filters.status);
    }
    if (filters.rawStage) {
      query = query.ilike("raw_stage", `%${filters.rawStage}%`);
      countQuery = countQuery.ilike("raw_stage", `%${filters.rawStage}%`);
    }
    if (filters.cityState) {
      query = query.or(`city.ilike.%${filters.cityState}%,state.ilike.%${filters.cityState}%`);
      countQuery = countQuery.or(`city.ilike.%${filters.cityState}%,state.ilike.%${filters.cityState}%`);
    }
    if (typeof filters.cartMin === "number") {
      query = query.gte("cart_value", filters.cartMin);
      countQuery = countQuery.gte("cart_value", filters.cartMin);
    }
    if (typeof filters.cartMax === "number") {
      query = query.lte("cart_value", filters.cartMax);
      countQuery = countQuery.lte("cart_value", filters.cartMax);
    }
    if (filters.dueToday) {
      query = query.gte("next_follow_up_at", startOfToday().toISOString()).lte("next_follow_up_at", endOfToday().toISOString());
      countQuery = countQuery.gte("next_follow_up_at", startOfToday().toISOString()).lte("next_follow_up_at", endOfToday().toISOString());
    }
    if (filters.missedFollowup) {
      query = query.lt("next_follow_up_at", new Date().toISOString()).not("current_status", "in", "(converted,lost)");
      countQuery = countQuery.lt("next_follow_up_at", new Date().toISOString()).not("current_status", "in", "(converted,lost)");
    }
    if (filters.untouchedHot) {
      query = query.eq("priority", "P1 Hot").is("last_contacted_at", null);
      countQuery = countQuery.eq("priority", "P1 Hot").is("last_contacted_at", null);
    }

    const orderByScore = query.order("lead_score", { ascending: false }).order("first_seen_at", { ascending: false });
    const { count, error: countError } = await countQuery;
    if (countError) throw countError;
    const leadsPage = options.all
      ? await fetchSupabaseLeadPages(orderByScore)
      : await fetchSupabaseLeadPage(orderByScore, (page - 1) * pageSize, page * pageSize - 1);
    return {
      leads: sortLeads(leadsPage, viewer),
      total: count ?? leadsPage.length,
      page,
      pageSize
    };
  }

  syncLocalDbFromDisk();
  let result = leads.map(withAssignedUser);
  if (viewer?.role === "salesperson") {
    result = result.filter((lead) => lead.assigned_to === viewer.id && lead.normalized_stage !== "INIT");
  }
  if (filters.priority) result = result.filter((lead) => lead.priority === filters.priority);
  if (filters.normalizedStage) result = result.filter((lead) => lead.normalized_stage === filters.normalizedStage);
  if (filters.source) result = result.filter((lead) => lead.source === filters.source);
  if (filters.assignedTo) result = result.filter((lead) => lead.assigned_to === filters.assignedTo);
  if (filters.status) result = result.filter((lead) => lead.current_status === filters.status);
  if (filters.rawStage) result = result.filter((lead) => (lead.raw_stage ?? "").toLowerCase().includes(filters.rawStage!.toLowerCase()));
  if (filters.cityState) {
    const value = filters.cityState.toLowerCase();
    result = result.filter((lead) => `${lead.city ?? ""} ${lead.state ?? ""}`.toLowerCase().includes(value));
  }
  if (typeof filters.cartMin === "number") result = result.filter((lead) => (lead.cart_value ?? 0) >= filters.cartMin!);
  if (typeof filters.cartMax === "number") result = result.filter((lead) => (lead.cart_value ?? 0) <= filters.cartMax!);
  if (filters.dueToday) result = result.filter((lead) => isToday(lead.next_follow_up_at));
  if (filters.missedFollowup) result = result.filter((lead) => isPast(lead.next_follow_up_at) && !["converted", "lost"].includes(lead.current_status));
  if (filters.untouchedHot) result = result.filter((lead) => lead.priority === "P1 Hot" && !lead.last_contacted_at);

  const sorted = sortLeads(result, viewer);
  const pageLeads = options.all ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize);
  return { leads: pageLeads, total: sorted.length, page, pageSize };
}

export function sortLeads(input: Lead[], viewer?: AppUser): Lead[] {
  return [...input].sort((a, b) => {
    if (viewer?.role === "salesperson") {
      const intent = compareLeadIntent(a.normalized_stage, b.normalized_stage);
      if (intent !== 0) return intent;
    }
    if (b.lead_score !== a.lead_score) return b.lead_score - a.lead_score;
    return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
  });
}

type SupabasePagedLeadQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: Lead[] | null; error: unknown }>;
};

async function fetchSupabaseLeadPages(query: SupabasePagedLeadQuery) {
  const pageSize = 1000;
  let start = 0;
  const all: Lead[] = [];

  while (true) {
    const { data, error } = await query.range(start, start + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Lead[];
    all.push(...page);
    if (page.length < pageSize) break;
    start += pageSize;
  }

  return all;
}

async function fetchSupabaseLeadPage(query: SupabasePagedLeadQuery, from: number, to: number) {
  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return (data ?? []) as Lead[];
}

export async function getLead(id: string): Promise<Lead | null> {
  if (hasSupabaseConfig()) {
    const { data, error } = await supabaseAdmin()
      .from("leads")
      .select("*, assigned_user:users(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as Lead | null;
  }
  syncLocalDbFromDisk();
  const lead = leads.find((item) => item.id === id);
  return lead ? withAssignedUser(lead) : null;
}

export async function getActivities(leadId?: string): Promise<Activity[]> {
  if (hasSupabaseConfig()) {
    let query = supabaseAdmin().from("activities").select("*, user:users(*)").order("created_at", { ascending: false });
    if (leadId) query = query.eq("lead_id", leadId);
    const { data, error } = await query;
    if (error) throw error;
    return data as Activity[];
  }
  syncLocalDbFromDisk();
  return activities
    .filter((activity) => !leadId || activity.lead_id === leadId)
    .map((activity) => ({
      ...activity,
      user: users.find((user) => user.id === activity.user_id) ?? null
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getFollowups(leadId?: string): Promise<FollowupTask[]> {
  if (hasSupabaseConfig()) {
    let query = supabaseAdmin().from("followup_tasks").select("*").order("due_at", { ascending: true });
    if (leadId) query = query.eq("lead_id", leadId);
    const { data, error } = await query;
    if (error) throw error;
    return data as FollowupTask[];
  }
  syncLocalDbFromDisk();
  return followups.filter((task) => !leadId || task.lead_id === leadId);
}

export async function getRecoveredOrders(): Promise<RecoveredOrder[]> {
  if (hasSupabaseConfig()) {
    const { data, error } = await supabaseAdmin().from("orders_recovered").select("*");
    if (error) throw error;
    return data as RecoveredOrder[];
  }
  syncLocalDbFromDisk();
  return recoveredOrders;
}

export async function logActivity(input: {
  lead_id: string;
  user_id: string;
  activity_type: ActivityType;
  outcome: ActivityOutcome;
  note: string;
  buyer_type?: string | null;
  next_follow_up_at?: string | null;
}) {
  const lead = await getLead(input.lead_id);
  if (!lead) throw new Error("Lead not found.");
  validateActivityInput(input);
  const needsFollowup = [
    "not_connected",
    "switched_off",
    "interested",
    "price_issue",
    "payment_issue",
    "delivery_issue",
    "wants_discount",
    "callback_requested"
  ].includes(input.outcome);
  if (needsFollowup && !input.next_follow_up_at) {
    throw new Error("Next follow-up date is required for this outcome.");
  }

  const createdAt = new Date().toISOString();
  const status = statusFromOutcome(input.outcome, input.next_follow_up_at);
  const countPatch = {
    total_call_attempts: lead.total_call_attempts + (input.activity_type === "call" ? 1 : 0),
    total_whatsapp_attempts: lead.total_whatsapp_attempts + (input.activity_type === "whatsapp" ? 1 : 0),
    total_touch_count: lead.total_touch_count + (["call", "whatsapp"].includes(input.activity_type) ? 1 : 0)
  };

  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    const { error: activityError } = await client.from("activities").insert({
      lead_id: input.lead_id,
      user_id: input.user_id,
      activity_type: input.activity_type,
      outcome: input.outcome,
      note: input.note,
      next_follow_up_at: input.next_follow_up_at ?? null,
      created_at: createdAt
    });
    if (activityError) throw activityError;

    const { error: leadError } = await client
      .from("leads")
      .update({
        ...countPatch,
        buyer_type: input.buyer_type || lead.buyer_type,
        current_status: status,
        last_contacted_at: ["call", "whatsapp"].includes(input.activity_type) ? createdAt : lead.last_contacted_at,
        next_follow_up_at: input.next_follow_up_at ?? lead.next_follow_up_at,
        updated_at: createdAt
      })
      .eq("id", input.lead_id);
    if (leadError) throw leadError;

    if (input.next_follow_up_at) {
      await client.from("followup_tasks").insert({
        lead_id: input.lead_id,
        assigned_to: lead.assigned_to ?? input.user_id,
        due_at: input.next_follow_up_at,
        status: "pending",
        followup_number: Math.min(5, lead.total_touch_count + 1),
        created_at: createdAt
      });
    }
    return;
  }

  activities.unshift({
    id: nextId("activity"),
    lead_id: input.lead_id,
    user_id: input.user_id,
    activity_type: input.activity_type,
    outcome: input.outcome,
    note: input.note,
    next_follow_up_at: input.next_follow_up_at ?? null,
    created_at: createdAt
  });

  const index = leads.findIndex((item) => item.id === input.lead_id);
  leads[index] = {
    ...leads[index],
    ...countPatch,
    buyer_type: input.buyer_type || lead.buyer_type,
    current_status: status,
    last_contacted_at: ["call", "whatsapp"].includes(input.activity_type) ? createdAt : lead.last_contacted_at,
    next_follow_up_at: input.next_follow_up_at ?? lead.next_follow_up_at,
    updated_at: createdAt
  };

  if (input.next_follow_up_at) {
    followups.unshift({
      id: nextId("followup"),
      lead_id: input.lead_id,
      assigned_to: lead.assigned_to ?? input.user_id,
      due_at: input.next_follow_up_at,
      status: "pending",
      followup_number: Math.min(5, lead.total_touch_count + 1),
      created_at: createdAt,
      completed_at: null
    });
  }
  saveLocalDbToDisk();
}

export async function markConverted(input: {
  lead_id: string;
  order_id: string;
  recovered_revenue: number;
  converted_by: string;
  converted_at: string;
}) {
  if (!input.order_id.trim()) throw new Error("Order ID is required.");
  if (input.recovered_revenue <= 0) throw new Error("Recovered revenue must be greater than zero.");

  const now = new Date().toISOString();
  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    const { error: orderError } = await client.from("orders_recovered").insert(input);
    if (orderError) throw orderError;
    const { error: leadError } = await client
      .from("leads")
      .update({ current_status: "converted", updated_at: now })
      .eq("id", input.lead_id);
    if (leadError) throw leadError;
    return;
  }

  recoveredOrders.unshift({
    id: nextId("order"),
    ...input
  });
  const index = leads.findIndex((lead) => lead.id === input.lead_id);
  if (index >= 0) {
    leads[index] = { ...leads[index], current_status: "converted", updated_at: now };
  }
  saveLocalDbToDisk();
}

export async function markSuspectedFake(input: {
  lead_id: string;
  user_id: string;
  note?: string;
}) {
  const lead = await getLead(input.lead_id);
  if (!lead) throw new Error("Lead not found.");

  const now = new Date().toISOString();
  const note = input.note?.trim() || "Marked as suspected fake order attempt by admin.";

  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    const { error: activityError } = await client.from("activities").insert({
      lead_id: input.lead_id,
      user_id: input.user_id,
      activity_type: "status_change",
      outcome: "lost",
      note,
      next_follow_up_at: null,
      created_at: now
    });
    if (activityError) throw activityError;

    const { error: leadError } = await client
      .from("leads")
      .update({
        current_status: "lost",
        next_follow_up_at: null,
        updated_at: now
      })
      .eq("id", input.lead_id);
    if (leadError) throw leadError;
    return;
  }

  activities.unshift({
    id: nextId("activity"),
    lead_id: input.lead_id,
    user_id: input.user_id,
    activity_type: "status_change",
    outcome: "lost",
    note,
    next_follow_up_at: null,
    created_at: now
  });

  const index = leads.findIndex((item) => item.id === input.lead_id);
  if (index >= 0) {
    leads[index] = {
      ...leads[index],
      current_status: "lost",
      next_follow_up_at: null,
      updated_at: now
    };
  }
  saveLocalDbToDisk();
}

export async function upsertImportedLead(input: ImportLeadInput): Promise<Lead> {
  syncLocalDbFromDisk();
  const now = new Date().toISOString();
  const stageInfo =
    input.source === "shiprocket_csv"
      ? {
          normalized_stage: "Phone received" as const,
          lead_score: scoreBrowserLead(input),
          priority: "P3 Nurture" as const
        }
      : scoreFromStage(input.raw_stage);

  const normalizedPhone = input.phone.replace(/[^\d+]/g, "");
  const existing = leads.find((lead) => {
    const samePhone = lead.phone.replace(/[^\d+]/g, "") === normalizedPhone;
    const sameCheckout = input.checkout_url && lead.checkout_url === input.checkout_url;
    return samePhone && (sameCheckout || !input.checkout_url || !lead.checkout_url);
  });

  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    const existingRow = await findSupabaseExistingLead(client, normalizedPhone, input.checkout_url ?? null);

    if (existingRow) {
      return updateSupabaseImportedLead(client, existingRow, input, normalizedPhone, stageInfo, now);
    }

    const { data, error } = await client
      .from("leads")
      .insert({
          ...input,
          ...stageInfo,
          phone: normalizedPhone,
          source_detail: input.source_detail ?? null,
          cart_value: safeCartValue(input.cart_value),
        first_seen_at: input.first_seen_at ?? now,
        current_status: input.current_status ?? "new",
        total_call_attempts: 0,
        total_whatsapp_attempts: 0,
        total_touch_count: 0,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await findSupabaseExistingLead(client, normalizedPhone, input.checkout_url ?? null);
        if (duplicate) {
          return updateSupabaseImportedLead(client, duplicate, input, normalizedPhone, stageInfo, now);
        }
      }
      throw error;
    }
    return data as Lead;
  }

  if (existing) {
    const index = leads.findIndex((lead) => lead.id === existing.id);
    const shouldUpdateStage = isHigherStage(stageInfo.normalized_stage, existing.normalized_stage);
    leads[index] = {
      ...existing,
      ...input,
      phone: normalizedPhone,
      cart_value: safeCartValue(input.cart_value),
      ...(shouldUpdateStage ? stageInfo : {}),
      raw_stage: input.raw_stage ?? existing.raw_stage,
      updated_at: now
    };
    saveLocalDbToDisk();
    return leads[index];
  }

  const lead: Lead = {
    id: nextId("lead"),
    source: input.source,
    source_detail: input.source_detail ?? null,
    raw_stage: input.raw_stage ?? (input.source === "shiprocket_csv" ? "Browser lead" : "INIT"),
    ...stageInfo,
    customer_name: input.customer_name ?? null,
    phone: normalizedPhone,
    email: input.email ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    buyer_type: input.buyer_type ?? null,
    product_names: input.product_names ?? null,
    product_url: input.product_url ?? null,
    checkout_url: input.checkout_url ?? null,
    recovery_url: input.recovery_url ?? null,
    cart_value: safeCartValue(input.cart_value),
    first_seen_at: input.first_seen_at ?? now,
    assigned_to: input.assigned_to ?? users.find((user) => user.role === "salesperson")?.id ?? null,
    current_status: input.current_status ?? "new",
    last_contacted_at: null,
    next_follow_up_at: input.next_follow_up_at ?? null,
    total_call_attempts: 0,
    total_whatsapp_attempts: 0,
    total_touch_count: 0,
    created_at: now,
    updated_at: now
  };
  leads.unshift(lead);
  saveLocalDbToDisk();
  return lead;
}

function safeCartValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 10000000) return null;
  return Math.round(value * 100) / 100;
}

async function findSupabaseExistingLead(
  client: ReturnType<typeof supabaseAdmin>,
  normalizedPhone: string,
  checkoutUrl: string | null
) {
  const { data: phoneRows, error: phoneError } = await client
    .from("leads")
    .select("*")
    .eq("phone", normalizedPhone)
    .limit(100);
  if (phoneError) throw phoneError;

  const phoneMatch = ((phoneRows ?? []) as Lead[]).find((lead) => {
    const samePhone = lead.phone.replace(/[^\d+]/g, "") === normalizedPhone;
    const sameCheckout = checkoutUrl && lead.checkout_url === checkoutUrl;
    return samePhone && (sameCheckout || !checkoutUrl || !lead.checkout_url);
  });
  if (phoneMatch) return phoneMatch;

  if (!checkoutUrl) return null;

  const { data: checkoutRows, error: checkoutError } = await client
    .from("leads")
    .select("*")
    .eq("checkout_url", checkoutUrl)
    .limit(100);
  if (checkoutError) throw checkoutError;

  return (
    ((checkoutRows ?? []) as Lead[]).find((lead) => lead.phone.replace(/[^\d+]/g, "") === normalizedPhone) ?? null
  );
}

async function updateSupabaseImportedLead(
  client: ReturnType<typeof supabaseAdmin>,
  existingRow: Lead,
  input: ImportLeadInput,
  normalizedPhone: string,
  stageInfo: Pick<Lead, "normalized_stage" | "lead_score" | "priority">,
  now: string
) {
  const shouldUpdateStage = isHigherStage(stageInfo.normalized_stage, existingRow.normalized_stage);
  const { data, error } = await client
    .from("leads")
    .update({
      ...input,
      phone: normalizedPhone,
      ...(shouldUpdateStage ? stageInfo : {}),
      raw_stage: input.raw_stage ?? existingRow.raw_stage,
      updated_at: now
    })
    .eq("id", existingRow.id)
    .select()
    .single();
  if (error) throw error;
  return data as Lead;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

function validateActivityInput(input: {
  activity_type: ActivityType;
  outcome: ActivityOutcome;
  note: string;
}) {
  if (!["call", "whatsapp"].includes(input.activity_type)) {
    throw new Error("Salespeople can only log calls or WhatsApp touches.");
  }
  if (!input.note.trim()) throw new Error("A note is required.");

  const callOutcomes: ActivityOutcome[] = [
    "connected",
    "not_connected",
    "switched_off",
    "interested",
    "not_interested",
    "price_issue",
    "payment_issue",
    "delivery_issue",
    "wants_discount"
  ];
  const whatsappOutcomes: ActivityOutcome[] = [
    "message_sent",
    "message_delivered",
    "message_read",
    "customer_replied",
    "callback_requested"
  ];
  const allowed = input.activity_type === "call" ? callOutcomes : whatsappOutcomes;
  if (!allowed.includes(input.outcome)) {
    throw new Error("That outcome is not valid for the selected outreach type.");
  }
}

export async function deduplicateLeads(mode: "phone_checkout" | "phone" = "phone_checkout") {
  syncLocalDbFromDisk();
  const allLeads = hasSupabaseConfig()
    ? ((await supabaseAdmin().from("leads").select("*")).data as Lead[] | null) ?? []
    : leads;
  const groups = new Map<string, Lead[]>();

  for (const lead of allLeads) {
    const key = duplicateKey(lead, mode);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  let deleted = 0;
  const kept: string[] = [];

  if (hasSupabaseConfig()) {
    const client = supabaseAdmin();
    for (const group of duplicateGroups) {
      const [winner, ...duplicates] = chooseWinner(group);
      const duplicateIds = duplicates.map((lead) => lead.id);
      kept.push(winner.id);
      if (duplicateIds.length === 0) continue;

      await client.from("activities").update({ lead_id: winner.id }).in("lead_id", duplicateIds);
      await client.from("followup_tasks").update({ lead_id: winner.id }).in("lead_id", duplicateIds);
      await client.from("orders_recovered").update({ lead_id: winner.id }).in("lead_id", duplicateIds);
      const { error } = await client.from("leads").delete().in("id", duplicateIds);
      if (error) throw error;
      deleted += duplicateIds.length;
    }
    return { mode, groups: duplicateGroups.length, deleted, kept };
  }

  for (const group of duplicateGroups) {
    const [winner, ...duplicates] = chooseWinner(group);
    const duplicateIds = new Set(duplicates.map((lead) => lead.id));
    kept.push(winner.id);

    for (const activity of activities) {
      if (duplicateIds.has(activity.lead_id)) activity.lead_id = winner.id;
    }
    for (const followup of followups) {
      if (duplicateIds.has(followup.lead_id)) followup.lead_id = winner.id;
    }
    for (const order of recoveredOrders) {
      if (duplicateIds.has(order.lead_id)) order.lead_id = winner.id;
    }

    for (let index = leads.length - 1; index >= 0; index -= 1) {
      if (duplicateIds.has(leads[index].id)) {
        leads.splice(index, 1);
        deleted += 1;
      }
    }
  }

  saveLocalDbToDisk();
  return { mode, groups: duplicateGroups.length, deleted, kept };
}

function duplicateKey(lead: Lead, mode: "phone_checkout" | "phone") {
  const phone = lead.phone.replace(/\D/g, "");
  if (!phone) return null;
  if (mode === "phone") return phone;
  const checkout = (lead.checkout_url ?? "").trim().toLowerCase();
  return checkout ? `${phone}|${checkout}` : phone;
}

function chooseWinner(group: Lead[]) {
  return [...group].sort((a, b) => {
    if (b.lead_score !== a.lead_score) return b.lead_score - a.lead_score;
    const updated = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (updated !== 0) return updated;
    return new Date(a.first_seen_at).getTime() - new Date(b.first_seen_at).getTime();
  });
}

function statusFromOutcome(outcome: ActivityOutcome, nextFollowup?: string | null): LeadStatus {
  if (outcome === "converted") return "converted";
  if (outcome === "lost" || outcome === "not_interested") return "lost";
  if (nextFollowup) return "follow_up";
  if (outcome === "connected" || outcome === "interested" || outcome === "wants_discount" || outcome === "customer_replied") {
    return "connected";
  }
  if (outcome === "not_connected" || outcome === "switched_off") return "not_reachable";
  return "contacted";
}
