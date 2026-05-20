import { NextResponse } from "next/server";
import { createManualLead, getCurrentUser } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only admins can create leads." }, { status: 403 });
    }

    const body = await request.json();
    const lead = await createManualLead({
      customer_name: body.customer_name,
      phone: String(body.phone ?? ""),
      email: body.email,
      city: body.city,
      state: body.state,
      buyer_type: body.buyer_type,
      product_names: body.product_names,
      product_url: body.product_url,
      checkout_url: body.checkout_url,
      cart_value: body.cart_value ? Number(body.cart_value) : null,
      raw_stage: body.raw_stage,
      assigned_to: body.assigned_to
    });
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create lead." }, { status: 400 });
  }
}
