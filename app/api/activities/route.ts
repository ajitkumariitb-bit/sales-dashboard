import { NextResponse } from "next/server";
import { logActivity } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await logActivity({
      lead_id: body.lead_id,
      user_id: body.user_id,
      activity_type: body.activity_type,
      outcome: body.outcome,
      note: body.note,
      buyer_type: body.buyer_type,
      next_follow_up_at: body.next_follow_up_at ? new Date(body.next_follow_up_at).toISOString() : null
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Activity failed" }, { status: 400 });
  }
}
