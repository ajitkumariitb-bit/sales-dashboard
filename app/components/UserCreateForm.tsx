"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UserCreateForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not create user.");
      return;
    }
    setMessage("User created.");
    router.refresh();
  }

  return (
    <form action={submit} className="panel grid">
      <h2>Create user</h2>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input name="name" required />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required />
        </label>
        <label className="field">
          <span>Role</span>
          <select name="role" defaultValue="salesperson">
            <option value="salesperson">Salesperson</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="field">
          <span>Temporary password</span>
          <input name="password" type="password" minLength={6} required />
        </label>
      </div>
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create user"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}
