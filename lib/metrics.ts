import { isPast, isToday, minutesBetween } from "./date";
import { uniqueConvertedCustomerCount } from "./recovery";
import type { Activity, AppUser, FollowupTask, Lead, RecoveredOrder } from "./types";

export function dashboardMetrics(input: {
  leads: Lead[];
  activities: Activity[];
  followups: FollowupTask[];
  orders: RecoveredOrder[];
}) {
  const { leads, activities, followups, orders } = input;
  const totalLeadsToday = leads.filter((lead) => isToday(lead.first_seen_at)).length;
  const conversions = uniqueConvertedCustomerCount(leads);
  const recoveredRevenue = orders.reduce((sum, order) => sum + order.recovered_revenue, 0);
  const connectedCalls = activities.filter((activity) => activity.activity_type === "call" && activity.outcome === "connected").length;
  const callsAttempted = leads.reduce((sum, lead) => sum + lead.total_call_attempts, 0);

  return {
    totalLeadsToday,
    p1Hot: leads.filter((lead) => lead.priority === "P1 Hot").length,
    p2Warm: leads.filter((lead) => lead.priority === "P2 Warm").length,
    p3Nurture: leads.filter((lead) => lead.priority === "P3 Nurture").length,
    paymentInitiated: leads.filter((lead) => lead.normalized_stage === "Payment initiated").length,
    orderScreen: leads.filter((lead) => lead.normalized_stage === "Order screen").length,
    followupsDueToday: followups.filter((task) => task.status === "pending" && isToday(task.due_at)).length,
    missedFollowups: followups.filter((task) => task.status === "missed" || (task.status === "pending" && isPast(task.due_at))).length,
    untouchedHot: leads.filter((lead) => lead.priority === "P1 Hot" && !lead.last_contacted_at).length,
    callsAttempted,
    connectedCalls,
    whatsappAttempts: leads.reduce((sum, lead) => sum + lead.total_whatsapp_attempts, 0),
    conversions,
    recoveredRevenue,
    conversionRate: leads.length ? Math.round((conversions / leads.length) * 1000) / 10 : 0
  };
}

export function leaderboard(input: {
  users: AppUser[];
  leads: Lead[];
  activities: Activity[];
  followups: FollowupTask[];
  orders: RecoveredOrder[];
}) {
  const salespeople = input.users.filter((user) => user.role === "salesperson");
  return salespeople.map((user) => {
    const assigned = input.leads.filter((lead) => lead.assigned_to === user.id);
    const userActivities = input.activities.filter((activity) => activity.user_id === user.id);
    const contactedLeadIds = new Set(userActivities.map((activity) => activity.lead_id));
    const connectedCalls = userActivities.filter((activity) => activity.activity_type === "call" && activity.outcome === "connected").length;
    const conversions = input.orders.filter((order) => order.converted_by === user.id);
    const convertedLeadIds = new Set(conversions.map((order) => order.lead_id));
    const assignedConverted = uniqueConvertedCustomerCount(assigned);
    const conversionCount = convertedLeadIds.size || assignedConverted;
    const firstContactMinutes = assigned
      .filter((lead) => lead.last_contacted_at)
      .map((lead) => minutesBetween(lead.first_seen_at, lead.last_contacted_at!));

    return {
      user,
      assignedLeads: assigned.length,
      leadsContacted: contactedLeadIds.size,
      contactRate: assigned.length ? Math.round((contactedLeadIds.size / assigned.length) * 1000) / 10 : 0,
      connectedCalls,
      followupsCompleted: input.followups.filter((task) => task.assigned_to === user.id && task.status === "completed").length,
      missedFollowups: input.followups.filter((task) => task.assigned_to === user.id && (task.status === "missed" || (task.status === "pending" && isPast(task.due_at)))).length,
      conversions: conversionCount,
      revenueRecovered: conversions.reduce((sum, order) => sum + order.recovered_revenue, 0),
      conversionRate: assigned.length ? Math.round((conversionCount / assigned.length) * 1000) / 10 : 0,
      averageTimeToFirstContact: firstContactMinutes.length
        ? Math.round(firstContactMinutes.reduce((sum, item) => sum + item, 0) / firstContactMinutes.length)
        : null,
      notConnectedRate: userActivities.length
        ? Math.round((userActivities.filter((activity) => activity.outcome === "not_connected").length / userActivities.length) * 1000) / 10
        : 0
    };
  });
}

export function riskFlags(lead: Lead) {
  const flags: { tone: "red" | "orange" | "yellow"; label: string }[] = [];
  const ageMinutes = minutesBetween(lead.first_seen_at);
  const open = !["converted", "lost"].includes(lead.current_status);

  if (lead.priority === "P1 Hot" && !lead.last_contacted_at && ageMinutes > 120) {
    flags.push({ tone: "red", label: "P1 untouched beyond 2h" });
  } else if (lead.priority === "P1 Hot" && !lead.last_contacted_at && ageMinutes > 30) {
    flags.push({ tone: "orange", label: "P1 SLA due" });
  }

  if (lead.priority === "P2 Warm" && !lead.last_contacted_at && ageMinutes > 360) {
    flags.push({ tone: "orange", label: "P2 untouched beyond 6h" });
  } else if (lead.priority === "P2 Warm" && !lead.last_contacted_at && ageMinutes > 120) {
    flags.push({ tone: "yellow", label: "P2 SLA due" });
  }

  if (open && !lead.next_follow_up_at && lead.total_touch_count > 0) {
    flags.push({ tone: "yellow", label: "No next follow-up" });
  }
  if (open && isPast(lead.next_follow_up_at)) {
    flags.push({ tone: "red", label: "Missed follow-up" });
  }
  if (lead.total_whatsapp_attempts > 0 && lead.total_call_attempts === 0 && lead.priority !== "P3 Nurture") {
    flags.push({ tone: "yellow", label: "WhatsApp only" });
  }
  if (lead.current_status === "not_reachable" && lead.total_call_attempts >= 3) {
    flags.push({ tone: "orange", label: "Repeated not connected" });
  }

  return flags;
}
