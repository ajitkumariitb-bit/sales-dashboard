import { NextResponse } from "next/server";
import { syncShopifyOrders } from "@/lib/shopify-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret && request.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncShopifyOrders();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return String(record.message ?? record.error_description ?? record.details ?? JSON.stringify(record));
  }
  return "Shopify sync failed";
}
