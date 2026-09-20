import type { NextRequest } from "next/server";

const publicBase = "/procurement/workspace";
const cookieName = "bb_procurement_session";
const maxBytes = 4 * 1024 * 1024;

/** Mount the independently authenticated engine without exposing CRM cookies or service keys. */
export async function proxyProcurement(request: NextRequest, parts: string[]) {
  const configured = process.env.PROCUREMENT_ENGINE_URL;
  if (!configured) {
    return Response.json({ error: "Procurement is not connected yet. Configure its persistent backend before use." }, { status: 503 });
  }
  let origin: URL;
  try {
    origin = new URL(configured);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error();
    if (!(["http:", "https:"].includes(origin.protocol))) throw new Error();
    if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") throw new Error();
    if (parts.some(part => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) throw new Error();
  } catch {
    return Response.json({ error: "Procurement backend configuration is invalid." }, { status: 503 });
  }

  const isWebhook = parts.join("/") === "webhooks/shopify";
  if (request.method === "POST" && !isWebhook) {
    const suppliedOrigin = request.headers.get("origin");
    // Next dev may normalize nextUrl to localhost even when the browser uses 127.0.0.1.
    // Compare the browser-controlled Origin with the actual HTTP Host, not that normalized URL.
    const host = request.headers.get("host");
    let sameOrigin = !suppliedOrigin;
    try { sameOrigin = !suppliedOrigin || (new URL(suppliedOrigin).host === host && new URL(suppliedOrigin).protocol === request.nextUrl.protocol); } catch { sameOrigin = false; }
    if (!sameOrigin) {
      return Response.json({ error: "Cross-origin writes are not allowed." }, { status: 403 });
    }
  }
  if (Number(request.headers.get("content-length") || 0) > maxBytes) {
    return Response.json({ error: "Upload is too large. Please use an image below 4 MB." }, { status: 413 });
  }
  const upstream = new URL(parts.map(encodeURIComponent).join("/"), origin);
  upstream.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ["content-type", "x-csrf-token", "idempotency-key", "x-shopify-hmac-sha256", "x-shopify-shop-domain", "x-shopify-topic", "x-shopify-webhook-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = request.cookies.get(cookieName)?.value;
  if (cookie && !isWebhook) headers.set("cookie", `${cookieName}=${cookie}`);
  const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > maxBytes) {
    return Response.json({ error: "Upload exceeds 4 MB." }, { status: 413 });
  }

  try {
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(25_000) });
    const outgoing = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
    for (const name of ["content-type", "content-security-policy", "referrer-policy"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const value of response.headers.getSetCookie()) {
      if (!value.startsWith(cookieName + "=")) continue;
      let scoped = value.replace(/;\s*Path=[^;]*/i, `; Path=${publicBase}`).replace(/;\s*Domain=[^;]*/i, "");
      if (process.env.NODE_ENV === "production" && !/;\s*Secure\b/i.test(scoped)) scoped += "; Secure";
      outgoing.append("set-cookie", scoped);
    }
    if ((response.headers.get("content-type") || "").includes("text/html")) {
      const html = (await response.text()).replaceAll('"/static/', `"${publicBase}/static/`);
      return new Response(html, { status: response.status, headers: outgoing });
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: "The procurement backend is unavailable. No successful inventory update has been confirmed. Retry the same action after connectivity is restored." }, { status: 502 });
  }
}
