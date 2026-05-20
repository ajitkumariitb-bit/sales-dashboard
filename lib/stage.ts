import type { NormalizedStage, Priority } from "./types";

export const stageScores: Record<NormalizedStage, number> = {
  INIT: 20,
  "Phone received": 40,
  "OTP verified": 60,
  "Address screen": 75,
  "Order screen": 90,
  "Payment initiated": 100
};

export const stageIntentLabels: Record<NormalizedStage, string> = {
  "Payment initiated": "highest intent",
  "Order screen": "very high intent",
  "Address screen": "warm intent",
  "OTP verified": "warm intent",
  "Phone received": "low-medium intent",
  INIT: "low intent / system noise"
};

export const salespersonStageOrder: NormalizedStage[] = [
  "Payment initiated",
  "Order screen",
  "Address screen",
  "OTP verified",
  "Phone received",
  "INIT"
];

export function normalizeStage(rawStage: string | null | undefined): NormalizedStage {
  const raw = (rawStage ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (raw.includes("payment initiated") || raw.includes("payment initiate") || raw.includes("payment")) {
    return "Payment initiated";
  }
  if (raw.includes("order screen") || raw.includes("order summary") || raw.includes("order")) {
    return "Order screen";
  }
  if (raw.includes("address screen") || raw.includes("address")) {
    return "Address screen";
  }
  if (raw.includes("otp verified") || raw.includes("otp verify") || raw.includes("otp")) {
    return "OTP verified";
  }
  if (raw.includes("phone received") || raw.includes("phone receive") || raw.includes("phone") || raw.includes("mobile")) {
    return "Phone received";
  }
  if (raw.includes("init")) return "INIT";
  return "INIT";
}

export function priorityFromScore(score: number): Priority {
  if (score >= 90) return "P1 Hot";
  if (score >= 60) return "P2 Warm";
  return "P3 Nurture";
}

export function scoreFromStage(rawStage: string | null | undefined): {
  normalized_stage: NormalizedStage;
  lead_score: number;
  priority: Priority;
} {
  const normalized_stage = normalizeStage(rawStage);
  const lead_score = stageScores[normalized_stage];
  return {
    normalized_stage,
    lead_score,
    priority: priorityFromScore(lead_score)
  };
}

export function scoreBrowserLead(input: {
  product_names?: string | null;
  product_url?: string | null;
  cart_value?: number | null;
}): number {
  let score = 35;
  if (input.product_names) score += 5;
  if (input.product_url) score += 3;
  if ((input.cart_value ?? 0) > 0) score += 2;
  return Math.min(score, 45);
}

export function compareLeadIntent(aStage: NormalizedStage, bStage: NormalizedStage): number {
  return salespersonStageOrder.indexOf(aStage) - salespersonStageOrder.indexOf(bStage);
}

export function isHigherStage(next: NormalizedStage, current: NormalizedStage): boolean {
  return stageScores[next] > stageScores[current];
}
