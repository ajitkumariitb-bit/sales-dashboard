import { NextResponse } from "next/server";
import { assignLead, bulkAssignLeads, bulkUnassignLeads, getCurrentUser } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (currentUser.role !== "admin") {
      return NextResponse.json({ error: "Only admins can assign leads." }, { status: 403 });
    }

    const body = await request.json();
    if (body.mode === "bulk_unassign") {
      const result = await bulkUnassignLeads({
        assigned_to: body.assigned_to || undefined,
        priority: body.priority || undefined,
        normalized_stage: body.normalized_stage || undefined,
        cart_min: numericValue(body.cart_min),
        cart_max: numericValue(body.cart_max),
        date_from: body.date_from || undefined,
        date_to: body.date_to || undefined,
        only_untouched: body.only_untouched === "on" || body.only_untouched === true,
        limit: Number(body.limit ?? 100)
      });
      return NextResponse.json(result);
    }

    if (body.mode === "bulk") {
      const result = await bulkAssignLeads({
        assigned_to: String(body.assigned_to),
        priority: body.priority || undefined,
        normalized_stage: body.normalized_stage || undefined,
        cart_min: numericValue(body.cart_min),
        cart_max: numericValue(body.cart_max),
        date_from: body.date_from || undefined,
        date_to: body.date_to || undefined,
        limit: Number(body.limit ?? 100)
      });
      return NextResponse.json(result);
    }

    await assignLead(String(body.lead_id), body.assigned_to ? String(body.assigned_to) : null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Assignment failed." }, { status: 400 });
  }
}

function numericValue(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
