"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CsvImportForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/import/shiprocket", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Import failed.");
      return;
    }
    setMessage(`Imported ${data.imported} browser leads. Skipped ${data.skipped}.`);
    router.refresh();
  }

  return (
    <form action={submit} className="panel grid">
      <div>
        <h2>Shiprocket Engage 360 CSV</h2>
        <p className="subtle">Accepted columns include customer_name, phone, product_names, product_url, event_date, whatsapp_status, and source.</p>
      </div>
      <label className="field">
        <span>CSV file</span>
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Importing..." : "Upload browser leads"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}
