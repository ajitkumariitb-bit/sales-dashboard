"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppUser } from "@/lib/types";

export function AssignLeadForm({
  leadId,
  users,
  assignedTo
}: {
  leadId: string;
  users: AppUser[];
  assignedTo?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function assign(value: string) {
    setBusy(true);
    await fetch("/api/admin/assign-lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_id: leadId, assigned_to: value || null })
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <select className="input" defaultValue={assignedTo ?? ""} onChange={(event) => assign(event.target.value)} disabled={busy}>
      <option value="">Unassigned</option>
      {users.filter((user) => user.role === "salesperson").map((user) => (
        <option key={user.id} value={user.id}>{user.name}</option>
      ))}
    </select>
  );
}

export function BulkAssignForm({ users }: { users: AppUser[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const mode = String(formData.get("mode") ?? "bulk");
    const body = Object.fromEntries(formData.entries());
    const payload =
      mode === "bulk_unassign"
        ? { ...body, mode, assigned_to: formData.get("unassign_assigned_to") || undefined }
        : { ...body, mode, assigned_to: formData.get("assign_to") };
    const response = await fetch("/api/admin/assign-lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Bulk action failed.");
      return;
    }
    setMessage(mode === "bulk_unassign" ? `Unassigned ${data.unassigned} leads.` : `Assigned ${data.assigned} leads.`);
    router.refresh();
  }

  return (
    <form action={submit} className="panel grid" style={{ marginBottom: 16 }}>
      <div>
        <h2>Bulk assignment</h2>
        <p className="subtle">Assign unassigned leads by priority, stage, order value, or created date. Start with P1 hot leads.</p>
      </div>
      <div className="filters">
        <label className="field">
          <span>Assign to</span>
          <select name="assign_to" required>
            {users.filter((user) => user.role === "salesperson").map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Unassign from</span>
          <select name="unassign_assigned_to" defaultValue="">
            <option value="">Any salesperson</option>
            {users.filter((user) => user.role === "salesperson").map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue="P1 Hot">
            <option value="">Any</option>
            <option>P1 Hot</option>
            <option>P2 Warm</option>
            <option>P3 Nurture</option>
          </select>
        </label>
        <label className="field">
          <span>Stage</span>
          <select name="normalized_stage" defaultValue="">
            <option value="">Any</option>
            <option>Payment initiated</option>
            <option>Order screen</option>
            <option>Address screen</option>
            <option>OTP verified</option>
            <option>Phone received</option>
          </select>
        </label>
        <label className="field">
          <span>Cart value min</span>
          <input name="cart_min" type="number" min="0" placeholder="Any" />
        </label>
        <label className="field">
          <span>Cart value max</span>
          <input name="cart_max" type="number" min="0" placeholder="Any" />
        </label>
        <label className="field">
          <span>Created from</span>
          <input name="date_from" type="date" />
        </label>
        <label className="field">
          <span>Created to</span>
          <input name="date_to" type="date" />
        </label>
        <label className="field">
          <span>Limit</span>
          <input name="limit" type="number" min="1" max="1000" defaultValue="100" />
        </label>
      </div>
      <div className="actions">
        <button className="button primary" type="submit" name="mode" value="bulk" disabled={busy}>
          {busy ? "Assigning..." : "Assign leads"}
        </button>
        <button
          className="button"
          type="submit"
          name="mode"
          value="bulk_unassign"
          disabled={busy}
        >
          {busy ? "Working..." : "Unassign matching leads"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}
