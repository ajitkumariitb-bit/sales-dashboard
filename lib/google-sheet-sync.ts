import { google } from "googleapis";
import { readFileSync } from "fs";
import { matchingAlias, parseDate, parseMoney, pick } from "./csv";
import { scoreFromStage } from "./stage";
import { upsertImportedLead } from "./store";
import { hasSupabaseConfig, supabaseAdmin } from "./supabase";
import type { ImportLeadInput } from "./types";

export function getGoogleCredentials() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (jsonPath) {
    const credentials = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      client_email?: string;
      private_key?: string;
    };
    return {
      email: credentials.client_email,
      key: credentials.private_key
    };
  }

  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n")
  };
}

export async function fetchGoogleSheetValues() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const range = process.env.GOOGLE_SHEET_RANGE ?? "Sheet1!A:Z";
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not configured.");
  const credentials = getGoogleCredentials();
  if (!credentials.email || !credentials.key) {
    throw new Error("Google service account credentials are not configured.");
  }

  const auth = new google.auth.JWT({
    email: credentials.email,
    key: credentials.key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return response.data.values ?? [];
}

export function buildRowsFromSheetValues(values: unknown[][]) {
  const headerIndex = findHeaderRowIndex(values);
  const headers = (values[headerIndex] ?? []).map(String);
  const body = values.slice(headerIndex + 1);
  const rows = body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [String(header).trim(), String(cells[index] ?? "").trim()]))
  );
  return { headerIndex, headers, rows };
}

export function findHeaderRowIndex(values: unknown[][]) {
  const candidates = values.slice(0, 15);
  let bestIndex = 0;
  let bestScore = -1;
  candidates.forEach((row, index) => {
    const headers = row.map(String);
    const score =
      headers.filter((header) => matchingAlias(header, "phone")).length * 5 +
      headers.filter((header) => matchingAlias(header, "customer_name")).length +
      headers.filter((header) => matchingAlias(header, "email")).length +
      headers.filter((header) => matchingAlias(header, "stage") || matchingAlias(header, "raw_stage")).length +
      headers.filter((header) => matchingAlias(header, "checkout_url")).length +
      headers.filter((header) => matchingAlias(header, "cart_value")).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export async function syncGoogleSheet() {
  const values = await fetchGoogleSheetValues();
  const { rows } = buildRowsFromSheetValues(values);

  const brandRows = rows.filter(matchesAllowedSheetSource);
  const imported = dedupeImportedRows(brandRows.map(mapSheetRow).filter((row) => row.phone));

  if (hasSupabaseConfig()) {
    const result = await bulkSyncSupabase(imported);
    return {
      imported: result.imported,
      skipped: rows.length - imported.length,
      brandFiltered: rows.length - brandRows.length,
      mode: "bulk"
    };
  }

  const results = [];
  for (const row of imported) {
    results.push(await upsertImportedLead(row));
  }

  return {
    imported: results.length,
    skipped: rows.length - results.length,
    brandFiltered: rows.length - brandRows.length
  };
}

function mapSheetRow(row: Record<string, string>): ImportLeadInput {
  const rawStage = pick(row, "raw_stage") ?? pick(row, "stage") ?? "";
  const scored = scoreFromStage(rawStage);
  return {
    source: "google_sheet" as const,
    source_detail: pick(row, "source_note"),
    raw_stage: rawStage,
    ...scored,
    customer_name: buildCustomerName(row),
    phone: pick(row, "phone") ?? "",
    email: pick(row, "email"),
    city: pick(row, "city"),
    state: pick(row, "state"),
    product_names: pick(row, "product_names"),
    product_url: pick(row, "product_url"),
    checkout_url: pick(row, "checkout_url"),
    recovery_url: pick(row, "recovery_url"),
    cart_value: parseMoney(pick(row, "cart_value")),
    first_seen_at: parseDate(pick(row, "first_seen_at"))
  };
}

function matchesAllowedSheetSource(row: Record<string, string>) {
  const filter = process.env.GOOGLE_SHEET_SOURCE_FILTER ?? "bliss,birch";
  const tokens = filter
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const searchable = [
    pick(row, "source_note"),
    pick(row, "product_url"),
    pick(row, "checkout_url"),
    pick(row, "recovery_url")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return tokens.some((token) => searchable.includes(token));
}

function dedupeImportedRows(rows: ImportLeadInput[]) {
  const byKey = new Map<string, ImportLeadInput>();
  for (const row of rows) {
    const phone = row.phone.replace(/[^\d+]/g, "");
    const key = `${phone}|${(row.checkout_url ?? "").trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || importedRowRank(row) > importedRowRank(existing)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function importedRowRank(row: ImportLeadInput) {
  const scored = scoreFromStage(row.raw_stage);
  const date = row.first_seen_at ? new Date(row.first_seen_at).getTime() : 0;
  return scored.lead_score * 10000000000000 + (Number.isFinite(date) ? date : 0);
}

async function bulkSyncSupabase(rows: ImportLeadInput[]) {
  const client = supabaseAdmin();
  const now = new Date().toISOString();
  let imported = 0;
  const chunkSize = 250;

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize).map((row) => {
      const scoring = scoreFromStage(row.raw_stage);
      return {
        source: "google_sheet",
        source_detail: row.source_detail ?? null,
        raw_stage: row.raw_stage ?? "",
        normalized_stage: scoring.normalized_stage,
        lead_score: scoring.lead_score,
        priority: scoring.priority,
        customer_name: row.customer_name ?? null,
        phone: row.phone.replace(/[^\d+]/g, ""),
        email: row.email ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        buyer_type: row.buyer_type ?? null,
        product_names: row.product_names ?? null,
        product_url: row.product_url ?? null,
        checkout_url: row.checkout_url ?? null,
        recovery_url: row.recovery_url ?? null,
        cart_value: row.cart_value ?? null,
        first_seen_at: row.first_seen_at ?? now,
        updated_at: now
      };
    });

    const { error } = await client.from("leads").upsert(chunk, {
      onConflict: "phone,checkout_url"
    });

    if (error) {
      if (error.code === "42P10") {
        throw new Error(
          "Supabase needs the fast sync unique index. Run supabase/migrations/003_fast_sheet_sync.sql in Supabase SQL Editor, then sync again."
        );
      }
      throw error;
    }

    imported += chunk.length;
  }

  return { imported };
}

function buildCustomerName(row: Record<string, string>) {
  const directName = pick(row, "customer_name");
  if (directName) return directName;
  const firstName = pick(row, "first_name");
  const lastName = pick(row, "last_name");
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || null;
}
