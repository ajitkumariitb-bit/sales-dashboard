import { redirect } from "next/navigation";
import { LoginForm } from "../components/LoginForm";
import { getOptionalCurrentUser } from "@/lib/store";

export default async function LoginPage() {
  const user = await getOptionalCurrentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/sales");

  return (
    <main className="login-page">
      <section className="panel login-panel">
        <div>
          <div className="eyebrow">Bliss & Birch</div>
          <h1>Sign in</h1>
          <p className="subtle">Sign in to manage checkout recovery and customer follow-ups.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
