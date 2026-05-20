import { NextResponse } from "next/server";
import { matchingAlias, pick } from "@/lib/csv";
import { buildRowsFromSheetValues, fetchGoogleSheetValues } from "@/lib/google-sheet-sync";

export async function GET() {
  try {
    const values = await fetchGoogleSheetValues();
    const { headerIndex, headers, rows } = buildRowsFromSheetValues(values);
    const phoneCount = rows.filter((row) => pick(row, "phone")).length;
    const stageCount = rows.filter((row) => pick(row, "stage") || pick(row, "raw_stage")).length;
    const sourceCounts = rows.reduce<Record<string, number>>((counts, row) => {
      const source = pick(row, "source_note") || "Blank";
      counts[source] = (counts[source] ?? 0) + 1;
      return counts;
    }, {});

    return NextResponse.json({
      totalRowsRead: values.length,
      headerRowNumber: headerIndex + 1,
      dataRows: rows.length,
      headers,
      detected: {
        phoneHeader: headers.find((header) => matchingAlias(header, "phone")) ?? null,
        nameHeader: headers.find((header) => matchingAlias(header, "customer_name")) ?? null,
        stageHeader: headers.find((header) => matchingAlias(header, "stage") || matchingAlias(header, "raw_stage")) ?? null,
        checkoutUrlHeader: headers.find((header) => matchingAlias(header, "checkout_url")) ?? null,
        cartValueHeader: headers.find((header) => matchingAlias(header, "cart_value")) ?? null,
        sourceHeader: headers.find((header) => matchingAlias(header, "source_note")) ?? null
      },
      rowsWithPhone: phoneCount,
      rowsWithStage: stageCount,
      sourceCounts,
      activeSourceFilter: process.env.GOOGLE_SHEET_SOURCE_FILTER ?? "bliss,birch",
      note: "No customer values are returned here, only headers and counts."
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheet debug failed" }, { status: 400 });
  }
}
