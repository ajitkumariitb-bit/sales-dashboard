"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncKind = "google-sheet" | "shopify-orders";

export function SyncPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<SyncKind | null>(null);
  const [message, setMessage] = useState("");

  async function runSync(kind: SyncKind) {
    setBusy(kind);
    setMessage("");
    const response = await fetch(`/api/sync/${kind}`, { method: "POST" });
    const data = await response.json();
    setBusy(null);

    if (!response.ok) {
      setMessage(data.error ?? "Sync failed.");
      return;
    }

    if (kind === "google-sheet") {
      setMessage(`Google Sheet sync complete. Imported ${data.imported ?? 0}, skipped ${data.skipped ?? 0}.`);
    } else {
      setMessage(
        `Shopify sync complete. Checked ${data.ordersChecked ?? 0}, converted ${data.converted ?? 0}, matched ${data.matched ?? 0}.` +
          (data.hasMore ? " More batches are available, run Shopify sync again." : "")
      );
    }
    router.refresh();
  }

  return (
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="section-head">
        <div>
          <h2>Sync data</h2>
          <p className="subtle">Bring in abandoned carts first, then match Shopify orders to mark recovered customers.</p>
        </div>
      </div>
      <div className="actions">
        <button className="button primary" type="button" onClick={() => runSync("google-sheet")} disabled={Boolean(busy)}>
          {busy === "google-sheet" ? "Syncing carts..." : "Sync Google Sheet"}
        </button>
        <button className="button" type="button" onClick={() => runSync("shopify-orders")} disabled={Boolean(busy)}>
          {busy === "shopify-orders" ? "Syncing orders..." : "Sync Shopify orders"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </section>
  );
}
