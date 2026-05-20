import { NextResponse } from "next/server";
import { mapShiprocketRows, parseCsv } from "@/lib/csv";
import { upsertImportedLead } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
    }

    const rows = parseCsv(await file.text());
    const leads = mapShiprocketRows(rows);
    for (const lead of leads) {
      await upsertImportedLead(lead);
    }

    return NextResponse.json({ imported: leads.length, skipped: rows.length - leads.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 400 });
  }
}
