import { NextResponse } from "next/server";
import { deduplicateLeads, getCurrentUser } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only admins can delete duplicate leads." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "phone" ? "phone" : "phone_checkout";
    const result = await deduplicateLeads(mode);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dedupe failed" }, { status: 400 });
  }
}
