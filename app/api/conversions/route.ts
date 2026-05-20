import { NextResponse } from "next/server";
import { getCurrentUser, markConverted } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only admins can record conversions." }, { status: 403 });
    }
    const body = await request.json();
    await markConverted({
      lead_id: body.lead_id,
      order_id: body.order_id,
      recovered_revenue: Number(body.recovered_revenue),
      converted_by: body.converted_by,
      converted_at: body.converted_at ? new Date(body.converted_at).toISOString() : new Date().toISOString()
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Conversion failed" }, { status: 400 });
  }
}
