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
          <div className="eyebrow">Lead Recovery CRM</div>
          <h1>Sign in</h1>
          <p className="subtle">Use the email and password created by the admin.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
