import type { Lead, RecoveredOrder } from "./types";

export function leadCustomerKey(lead: Pick<Lead, "phone" | "email">) {
  const phone = lead.phone.replace(/\D/g, "").slice(-10);
  if (phone) return `phone:${phone}`;
  const email = lead.email?.trim().toLowerCase();
  return email ? `email:${email}` : "";
}

export function recoveredRevenueByCustomer(leads: Lead[], orders: RecoveredOrder[]) {
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const revenue: Record<string, number> = {};

  for (const order of orders) {
    const lead = leadsById.get(order.lead_id);
    if (!lead) continue;
    const key = leadCustomerKey(lead);
    if (!key) continue;
    revenue[key] = (revenue[key] ?? 0) + order.recovered_revenue;
  }

  return revenue;
}

export function recoveredRevenueByLead(orders: RecoveredOrder[]) {
  const revenue: Record<string, number> = {};

  for (const order of orders) {
    revenue[order.lead_id] = (revenue[order.lead_id] ?? 0) + order.recovered_revenue;
  }

  return revenue;
}

export function uniqueConvertedCustomerCount(leads: Lead[]) {
  return new Set(
    leads
      .filter((lead) => lead.current_status === "converted")
      .map(leadCustomerKey)
      .filter(Boolean)
  ).size;
}
