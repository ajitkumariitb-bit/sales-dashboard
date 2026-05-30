"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DedupeButton() {
  const router = useRouter();
  const [mode, setMode] = useState<"phone_checkout" | "phone" | "recovered_customer">("phone_checkout");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function runCleanup() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/dedupe-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Cleanup failed.");
      return;
    }
    setMessage(`Deleted ${data.deleted} duplicates from ${data.groups} duplicate groups.`);
    router.refresh();
  }

  return (
    <div className="actions">
      <select
        className="input"
        value={mode}
        onChange={(event) => setMode(event.target.value as "phone_checkout" | "phone" | "recovered_customer")}
      >
        <option value="phone_checkout">Same phone + checkout URL</option>
        <option value="recovered_customer">Same phone after recovery</option>
        <option value="phone">Same phone only</option>
      </select>
      <button className="button" type="button" onClick={runCleanup} disabled={busy}>
        {busy ? "Cleaning..." : "Delete duplicates"}
      </button>
      {message ? <span className="subtle">{message}</span> : null}
    </div>
  );
}
