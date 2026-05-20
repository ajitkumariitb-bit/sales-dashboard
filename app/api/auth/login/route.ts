import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { hasSupabaseConfig, supabaseAdmin } from "@/lib/supabase";
import { getUsers } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (hasSupabaseConfig()) {
    const { data, error } = await supabaseAdmin()
      .from("users")
      .select("id,name,email,role,password_hash,created_at")
      .eq("email", email)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data || !verifyPassword(password, data.password_hash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, role: data.role });
    response.cookies.set("lrcrm_user_id", data.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14
    });
    return response;
  }

  const user = (await getUsers()).find((item) => item.email.toLowerCase() === email);
  if (!user || password !== "demo123") {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set("lrcrm_user_id", user.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return response;
}
