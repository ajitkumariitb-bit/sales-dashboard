import { NextResponse } from "next/server";
import { assignLead, bulkAssignLeads, getCurrentUser } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (currentUser.role !== "admin") {
      return NextResponse.json({ error: "Only admins can assign leads." }, { status: 403 });
    }

    const body = await request.json();
    if (body.mode === "bulk") {
      const result = await bulkAssignLeads({
        assigned_to: String(body.assigned_to),
        priority: body.priority || undefined,
        normalized_stage: body.normalized_stage || undefined,
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
