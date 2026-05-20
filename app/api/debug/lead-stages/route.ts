import { NextResponse } from "next/server";
import { getLeads } from "@/lib/store";

export async function GET() {
  const leads = await getLeads();
  const rawStages = leads.reduce<Record<string, number>>((counts, lead) => {
    const key = lead.raw_stage || "Blank";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const normalizedStages = leads.reduce<Record<string, number>>((counts, lead) => {
    counts[lead.normalized_stage] = (counts[lead.normalized_stage] ?? 0) + 1;
    return counts;
  }, {});
  const priorities = leads.reduce<Record<string, number>>((counts, lead) => {
    counts[lead.priority] = (counts[lead.priority] ?? 0) + 1;
    return counts;
  }, {});

  return NextResponse.json({
    total: leads.length,
    rawStages,
    normalizedStages,
    priorities,
    note: "Counts only. No customer data is returned."
  });
}
