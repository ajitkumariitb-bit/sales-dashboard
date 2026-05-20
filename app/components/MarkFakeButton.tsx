"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkFakeButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function markFake() {
    const confirmed = window.confirm("Mark this lead as suspected fake order attempt? It will be moved to lost and excluded from conversions.");
    if (!confirmed) return;

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/mark-fake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: leadId,
        note: "Suspected fake order attempt. Excluded from recovered conversion reporting."
      })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not update lead.");
      return;
    }
    setMessage("Marked as suspected fake.");
    router.refresh();
  }

  return (
    <div className="grid">
      <button className="button danger" type="button" onClick={markFake} disabled={busy}>
        {busy ? "Marking..." : "Mark suspected fake"}
      </button>
      {message ? <span className="subtle">{message}</span> : null}
    </div>
  );
}
