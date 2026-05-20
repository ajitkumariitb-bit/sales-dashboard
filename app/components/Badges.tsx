import type { LeadStatus, NormalizedStage, Priority } from "@/lib/types";

export function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = priority.startsWith("P1") ? "p1" : priority.startsWith("P2") ? "p2" : "p3";
  return <span className={`badge ${cls}`}>{priority}</span>;
}

export function StageBadge({ stage }: { stage: NormalizedStage }) {
  const cls =
    stage === "Payment initiated"
      ? "stage-payment"
      : stage === "Order screen"
        ? "stage-order"
        : stage === "Address screen" || stage === "OTP verified"
          ? "stage-warm"
          : "stage-low";
  return <span className={`badge ${cls}`}>{stage}</span>;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className="badge status">{status.replace("_", " ")}</span>;
}

export function FlagBadge({ tone, label }: { tone: "red" | "orange" | "yellow"; label: string }) {
  return <span className={`badge flag-${tone}`}>{label}</span>;
}
