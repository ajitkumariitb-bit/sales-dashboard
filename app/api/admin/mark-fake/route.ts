import { NextResponse } from "next/server";
import { getCurrentUser, markSuspectedFake } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only admins can mark suspected fake orders." }, { status: 403 });
    }

    const body = await request.json();
    await markSuspectedFake({
      lead_id: body.lead_id,
      user_id: user.id,
      note: body.note
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not mark fake." }, { status: 400 });
  }
}
