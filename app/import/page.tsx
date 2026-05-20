import { CsvImportForm } from "../components/CsvImportForm";

export default function ImportPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Import</div>
          <h1>Browser lead upload</h1>
          <p className="subtle">Shiprocket Engage 360 product-view leads enter as P3 nurture leads and remain visible separately as browser leads.</p>
        </div>
      </div>
      <CsvImportForm />
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Google Sheet sync</h2>
        <p className="subtle">
          Configure the environment variables in .env.local and schedule POST /api/sync/google-sheet every 30 minutes from Vercel Cron.
        </p>
      </section>
    </>
  );
}
