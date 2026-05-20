import type { ImportLeadInput } from "./types";

const aliases: Record<string, string[]> = {
  customer_name: ["customer_name", "name", "customer name", "full name", "first_name", "first name"],
  first_name: ["first_name", "first name"],
  last_name: ["last_name", "last name", "surname"],
  phone: [
    "phone",
    "mobile",
    "phone number",
    "mobile number",
    "contact",
    "contact number",
    "customer phone",
    "customer mobile",
    "phone no",
    "mobile no",
    "phone_no",
    "mobile_no",
    "billing phone",
    "shipping phone",
    "telephone",
    "customer contact",
    "whatsapp",
    "whatsapp number"
  ],
  email: ["email", "email address", "customer email"],
  city: ["city", "shipping city", "billing city"],
  state: ["state", "province", "shipping state", "billing state"],
  raw_stage: ["raw_stage", "raw stage", "checkout stage", "latest_stage", "latest stage"],
  stage: ["stage", "checkout step", "status", "latest_stage", "latest stage"],
  product_names: ["product_names", "product", "products", "product name", "product details", "items_0_name", "items 0 name", "items_0_title", "items 0 title"],
  product_url: ["product_url", "product url", "page url", "browser url"],
  checkout_url: ["checkout_url", "checkout url", "cart url", "abandoned checkout url"],
  recovery_url: ["recovery_url", "recovery url", "abandoned cart recovery url"],
  first_seen_at: ["event_date", "created date", "created_at", "updated_at", "updated at", "first_seen_at", "date", "timestamp"],
  source_note: ["source", "lead source", "source_name", "source name", "store", "brand"],
  whatsapp_status: ["whatsapp_status", "whatsapp status"],
  cart_value: ["cart value", "order value", "value", "amount", "total_price", "total price", "items_0_price", "items 0 price"]
};

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  if (current || row.length) {
    row.push(current.trim());
    rows.push(row);
  }

  const [headers = [], ...body] = rows.filter((item) => item.some(Boolean));
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index]?.trim() ?? ""]))
  );
}

export function mapShiprocketRows(rows: Record<string, string>[]): ImportLeadInput[] {
  return rows
    .map((row) => ({
      source: "shiprocket_csv" as const,
      raw_stage: "Browser lead",
      customer_name: pick(row, "customer_name"),
      phone: pick(row, "phone") ?? "",
      product_names: pick(row, "product_names"),
      product_url: pick(row, "product_url"),
      first_seen_at: parseDate(pick(row, "first_seen_at")),
      cart_value: parseNumber(pick(row, "cart_value"))
    }))
    .filter((row) => row.phone);
}

export function pick(row: Record<string, string>, key: string): string | null {
  const normalized = Object.fromEntries(Object.entries(row).map(([name, value]) => [cleanHeader(name), value]));
  for (const alias of aliases[key] ?? [key]) {
    const value = normalized[cleanHeader(alias)];
    if (value) return value;
  }
  return null;
}

export function cleanHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchingAlias(header: string, key: string) {
  const cleaned = cleanHeader(header);
  return (aliases[key] ?? [key]).some((alias) => cleanHeader(alias) === cleaned);
}

export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return number;
}

export function parseMoney(value: string | null | undefined): number | null {
  const number = parseNumber(value);
  if (number === null) return null;
  if (number < 0 || number > 10000000) return null;
  return Math.round(number * 100) / 100;
}

export function parseDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
