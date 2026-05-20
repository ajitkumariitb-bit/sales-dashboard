import { NextResponse } from "next/server";
import { createCrmUser, getCurrentUser } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (currentUser.role !== "admin") {
      return NextResponse.json({ error: "Only admins can create users." }, { status: 403 });
    }

    const body = await request.json();
    const user = await createCrmUser({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      role: body.role === "admin" ? "admin" : "salesperson",
      password: String(body.password ?? "")
    });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create user." }, { status: 400 });
  }
}
