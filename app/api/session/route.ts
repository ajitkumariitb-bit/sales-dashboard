import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabase";
import { getUsers } from "@/lib/store";

export async function POST(request: Request) {
  if (hasSupabaseConfig()) {
    return NextResponse.json({ error: "Demo session switching is disabled." }, { status: 403 });
  }
  const { userId } = await request.json();
  const users = await getUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("lrcrm_user_id", user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}
