"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Login failed.");
      return;
    }
    router.push(data.role === "admin" ? "/admin" : "/sales");
    router.refresh();
  }

  return (
    <form action={submit} className="grid">
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
      {message ? <span className="subtle">{message}</span> : null}
    </form>
  );
}
