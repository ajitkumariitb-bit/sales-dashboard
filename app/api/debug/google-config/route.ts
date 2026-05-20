import { existsSync } from "fs";
import { NextResponse } from "next/server";

export async function GET() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  return NextResponse.json({
    sheetIdSet: Boolean(sheetId),
    sheetRange: process.env.GOOGLE_SHEET_RANGE ?? "Sheet1!A:Z",
    usingJsonPath: Boolean(jsonPath),
    jsonPathExists: jsonPath ? existsSync(jsonPath) : false,
    emailSet: Boolean(email),
    privateKeySet: Boolean(privateKey),
    privateKeyLooksValid:
      Boolean(privateKey?.includes("BEGIN PRIVATE KEY")) && Boolean(privateKey?.includes("END PRIVATE KEY")),
    note: "This endpoint only shows whether values are set. It does not return secrets."
  });
}
