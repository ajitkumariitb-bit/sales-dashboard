"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppUser } from "@/lib/types";

const buyerTypes = ["Normal customer", "Architect", "Interior designer", "Company / project buyer", "Trader / reseller", "Other"];

export function ManualLeadForm({ users }: { users: AppUser[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/manual-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not create lead.");
      return;
    }
    router.push(`/leads/${data.lead.id}`);
    router.refresh();
  }

  return (
    <form action={submit} className="panel grid">
      <div>
        <h2>Create manual lead</h2>
        <p className="subtle">Use this for Instagram DMs, walk-ins, architect/interior leads, referrals, or direct phone enquiries.</p>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Customer name</span>
          <input name="customer_name" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input name="phone" required />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label className="field">
          <span>Buyer type</span>
          <select name="buyer_type" defaultValue="">
            <option value="">Not known</option>
            {buyerTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>City</span>
          <input name="city" />
        </label>
        <label className="field">
          <span>State</span>
          <input name="state" />
        </label>
        <label className="field full">
          <span>Product / requirement</span>
          <input name="product_names" placeholder="Example: Chandelier fan, table lamp, wall lights, bulk lighting enquiry" />
        </label>
        <label className="field">
          <span>Product URL</span>
          <input name="product_url" type="url" />
        </label>
        <label className="field">
          <span>Cart value / expected value</span>
          <input name="cart_value" type="number" min="0" step="1" />
        </label>
        <label className="field">
          <span>Lead stage</span>
          <select name="raw_stage" defaultValue="Phone received">
            <option>Phone received</option>
            <option>OTP verified</option>
            <option>Address screen</option>
            <option>Order screen</option>
            <option>Payment initiated</option>
          </select>
        </label>
        <label className="field">
          <span>Assign to</span>
          <select name="assigned_to" defaultValue="">
            <option value="">Unassigned</option>
            {users.filter((user) => user.role === "salesperson").map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create lead"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}
