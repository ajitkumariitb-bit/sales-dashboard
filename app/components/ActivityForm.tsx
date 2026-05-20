"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActivityOutcome, AppUser } from "@/lib/types";

const callConnectionOutcomes: ActivityOutcome[] = ["connected", "not_connected", "switched_off"];
const callConversationOutcomes: ActivityOutcome[] = [
  "interested",
  "not_interested",
  "price_issue",
  "payment_issue",
  "delivery_issue",
  "wants_discount"
];
const whatsappOutcomes: ActivityOutcome[] = [
  "message_sent",
  "message_delivered",
  "message_read",
  "customer_replied",
  "callback_requested"
];
const buyerTypes = [
  "Normal customer",
  "Architect",
  "Interior designer",
  "Company / project buyer",
  "Trader / reseller",
  "Other"
];

export function ActivityForm({
  leadId,
  currentUser,
  buyerType
}: {
  leadId: string;
  currentUser: AppUser;
  buyerType?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityType, setActivityType] = useState<"call" | "whatsapp">("call");
  const [callConnection, setCallConnection] = useState<ActivityOutcome>("connected");
  const showConversation = activityType === "call" && callConnection === "connected";

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
    const outcome =
      activityType === "call" && payload.call_connection === "connected"
        ? payload.conversation_outcome
        : activityType === "call"
          ? payload.call_connection
          : payload.whatsapp_outcome;
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: leadId,
        user_id: currentUser.id,
        activity_type: activityType,
        outcome,
        buyer_type: payload.buyer_type || null,
        note: payload.note,
        next_follow_up_at: payload.next_follow_up_at || null
      })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not log activity.");
      return;
    }
    setMessage("Activity logged.");
    router.refresh();
  }

  return (
    <form action={submit} className="grid">
      <div className="form-grid">
        <label className="field">
          <span>Outreach type</span>
          <select
            name="activity_type"
            value={activityType}
            onChange={(event) => setActivityType(event.target.value as "call" | "whatsapp")}
          >
            <option value="call">Log call</option>
            <option value="whatsapp">Log WhatsApp</option>
          </select>
        </label>
        {activityType === "call" ? (
          <label className="field">
            <span>Call connection</span>
            <select
              name="call_connection"
              value={callConnection}
              onChange={(event) => setCallConnection(event.target.value as ActivityOutcome)}
            >
              {callConnectionOutcomes.map((outcome) => (
                <option key={outcome} value={outcome}>{label(outcome)}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>WhatsApp result</span>
            <select name="whatsapp_outcome" defaultValue="message_sent">
              {whatsappOutcomes.map((outcome) => (
                <option key={outcome} value={outcome}>{label(outcome)}</option>
              ))}
            </select>
          </label>
        )}
        {showConversation ? (
          <label className="field">
            <span>What did the buyer say?</span>
            <select name="conversation_outcome" defaultValue="interested">
              {callConversationOutcomes.map((outcome) => (
                <option key={outcome} value={outcome}>{label(outcome)}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>Buyer type</span>
          <select name="buyer_type" defaultValue={buyerType ?? ""}>
            <option value="">Not known</option>
            {buyerTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field full">
          <span>Note</span>
          <textarea name="note" required placeholder={activityType === "call" ? "Write what happened on the call." : "Mention message sent, reply received, or next context."} />
        </label>
        <label className="field">
          <span>Next follow-up</span>
          <input type="datetime-local" name="next_follow_up_at" />
        </label>
      </div>
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save activity"}
        </button>
        {message ? <span className="subtle">{message}</span> : null}
      </div>
    </form>
  );
}

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
