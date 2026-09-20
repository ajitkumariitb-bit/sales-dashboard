import Link from "next/link";
import { getCurrentUser } from "@/lib/store";
import styles from "./procurement.module.css";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  await getCurrentUser();
  const connected = Boolean(process.env.PROCUREMENT_ENGINE_URL);
  return (
    <section className={styles.workspace}>
      <div className={styles.eyebrow}>BLISS &amp; BIRCH · OPERATIONS</div>
      <header className={styles.header}>
        <div>
          <h1>From customer order<br />to ready to ship.</h1>
          <p>A shared workspace for procurement, physical inventory, receiving, and packing.</p>
        </div>
        <span className={styles.status}>{connected ? "Workspace connected" : "Ready for connection"}</span>
      </header>
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>PROCUREMENT ENGINE</div>
          <h2>Know what to buy.<br />Know what can go out.</h2>
          <p>Bring customer shortages together, track purchases from each vendor, and allocate received goods to the orders waiting for them.</p>
          {connected ? <a className={styles.primary} href="/procurement/workspace/">Open operations workspace →</a> : <div className={styles.notice}>The workspace is built. Its persistent backend must be connected before this online entry can accept inventory changes.</div>}
        </div>
        <ol className={styles.steps}>
          <li><span>01</span><div><strong>Procure</strong><p>Products, vendors, shortages, and incoming purchases.</p></div></li>
          <li><span>02</span><div><strong>Receive &amp; verify</strong><p>Record usable quantities and capture real product photos.</p></div></li>
          <li><span>03</span><div><strong>Pack &amp; hand over</strong><p>Pick reserved items, pack complete orders, and confirm shipment.</p></div></li>
        </ol>
      </div>
      <div className={styles.cards}>
        <article><h3>Sales</h3><p>Search an order or customer and see item-level progress without calling Procurement.</p></article>
        <article><h3>Procurement</h3><p>See exactly what is needed, record a purchase, and track its arrival.</p></article>
        <article><h3>Packing</h3><p>Work from a queue of orders whose physical items are reserved and ready.</p></article>
        <article><h3>Admin</h3><p>Review exceptions, stock corrections, image approvals, and the complete audit trail.</p></article>
      </div>
      <p className={styles.footnote}>Procurement has its own role-protected sign-in. Physical stock does not automatically change Shopify availability.</p>
      <Link className={styles.back} href="/sales">← Return to Sales Dashboard</Link>
    </section>
  );
}
