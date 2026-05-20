"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppUser } from "@/lib/types";

export function ConversionForm({ leadId, users }: { leadId: string; users: AppUser[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const salespeople = users.filter((user) => user.role === "salesperson");

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/conversions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: leadId,
        order_id: payload.order_id,
        recovered_revenue: Number(payload.recovered_revenue),
        converted_by: payload.converted_by,
        converted_at: payload.converted_at || new Date().toISOString()
      })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not mark converted.");
      return;
    }
    setMessage("Conversion saved.");
    router.refresh();
  }

  return (
    <form action={submit} className="grid">
      <div className="form-grid">
        <label className="field">
          <span>Order ID</span>
          <input name="order_id" required />
        </label>
        <label className="field">
          <span>Recovered revenue</span>
          <input name="recovered_revenue" type="number" min="1" step="1" required />
        </label>
        <label className="field">
          <span>Converted by</span>
          <select name="converted_by" required>
            {salespeople.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Converted date</span>
          <input name="converted_at" type="datetime-local" />
        </label>
      </div>
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Mark converted"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}
