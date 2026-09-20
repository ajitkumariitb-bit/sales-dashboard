import type { NextRequest } from "next/server";
import { proxyProcurement } from "@/lib/procurement-proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: NextRequest, context: Context) {
  return proxyProcurement(request, (await context.params).path ?? []);
}
export async function POST(request: NextRequest, context: Context) {
  return proxyProcurement(request, (await context.params).path ?? []);
}
