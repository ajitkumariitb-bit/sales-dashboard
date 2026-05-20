import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCurrency, formatDateTime, isPast } from "@/lib/date";
import { riskFlags } from "@/lib/metrics";
import { getActivities, getCurrentUser, getFollowups, getLead, getUsers } from "@/lib/store";
import { ActivityForm } from "../../components/ActivityForm";
import { AssignLeadForm } from "../../components/AssignLeadForm";
import { FlagBadge, PriorityBadge, StageBadge, StatusBadge } from "../../components/Badges";
import { ConversionForm } from "../../components/ConversionForm";
import { MarkFakeButton } from "../../components/MarkFakeButton";

type Params = Promise<{ id: string }>;

export default async function LeadDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const [lead, currentUser, users, activities, followups] = await Promise.all([
    getLead(id),
    getCurrentUser(),
    getUsers(),
    getActivities(id),
    getFollowups(id)
  ]);
  if (!lead) notFound();

  const completedTouches = Math.min(5, lead.total_touch_count);
  const openFollowups = followups.filter((task) => task.status === "pending");

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Lead detail</div>
          <h1>{lead.customer_name ?? "Unknown customer"}</h1>
          <p className="subtle">{lead.phone} · {lead.email ?? "No email"} · {lead.city ?? "Unknown city"}</p>
          <div className="badge-row" style={{ marginTop: 10 }}>
            <PriorityBadge priority={lead.priority} />
            <StageBadge stage={lead.normalized_stage} />
            <StatusBadge status={lead.current_status} />
            {riskFlags(lead).map((flag) => <FlagBadge key={flag.label} {...flag} />)}
          </div>
        </div>
        <div className="actions">
          <Link className="button" href="/leads">Back to leads</Link>
          {lead.checkout_url ? <a className="button primary" href={lead.checkout_url} target="_blank">Checkout</a> : null}
          {lead.recovery_url ? <a className="button" href={lead.recovery_url} target="_blank">Recovery URL</a> : null}
        </div>
      </div>

      <div className="grid two-col">
        <div className="grid">
          <section className="panel">
            <div className="section-head">
              <h2>Customer and cart</h2>
            </div>
            <div className="detail-list">
              <div className="detail-item"><span>Customer</span><strong>{lead.customer_name ?? "Unknown"}</strong></div>
              <div className="detail-item"><span>Phone</span><strong>{lead.phone}</strong></div>
              <div className="detail-item"><span>Email</span><strong>{lead.email ?? "Not captured"}</strong></div>
              <div className="detail-item"><span>Location</span><strong>{lead.city ?? "Unknown"}{lead.state ? `, ${lead.state}` : ""}</strong></div>
              <div className="detail-item"><span>Buyer type</span><strong>{lead.buyer_type ?? "Not known"}</strong></div>
              <div className="detail-item"><span>Product</span><strong>{lead.product_names ?? "Not captured"}</strong></div>
              <div className="detail-item"><span>Cart value</span><strong>{formatCurrency(lead.cart_value)}</strong></div>
              <div className="detail-item"><span>Source</span><strong>{lead.source.replace("_", " ")}</strong></div>
              <div className="detail-item"><span>Assigned</span><strong>{lead.assigned_user?.name ?? "Unassigned"}</strong></div>
              <div className="detail-item"><span>Raw stage</span><strong>{lead.raw_stage ?? "Unknown"}</strong></div>
              <div className="detail-item"><span>First seen</span><strong>{formatDateTime(lead.first_seen_at)}</strong></div>
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Follow-up structure</h2>
                <p className="subtle">Touch 1 Day 0 call + WhatsApp, Touch 2 Day 1 call, Touch 3 Day 3 offer reminder, Touch 4 Day 5 urgency, Touch 5 Day 7 final closure.</p>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-item"><span>Completed follow-up number</span><strong>{completedTouches} of 5</strong></div>
              <div className="detail-item"><span>Next follow-up</span><strong>{formatDateTime(lead.next_follow_up_at)}</strong></div>
              <div className="detail-item"><span>Missed follow-up flag</span><strong>{isPast(lead.next_follow_up_at) && !["converted", "lost"].includes(lead.current_status) ? "Yes" : "No"}</strong></div>
              <div className="detail-item"><span>Total touches done</span><strong>{lead.total_touch_count}</strong></div>
            </div>
            <div className="timeline" style={{ marginTop: 12 }}>
              {followups.map((task) => (
                <div key={task.id} className="timeline-item">
                  <strong>Touch {task.followup_number} · {task.status}</strong>
                  <span className="subtle">Due {formatDateTime(task.due_at)}{task.completed_at ? ` · completed ${formatDateTime(task.completed_at)}` : ""}</span>
                </div>
              ))}
              {openFollowups.length === 0 && followups.length === 0 ? <p className="subtle">No follow-up tasks yet.</p> : null}
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>Activity timeline</h2>
            </div>
            <div className="timeline">
              {activities.map((activity) => (
                <div key={activity.id} className="timeline-item">
                  <strong>{activity.activity_type.replace("_", " ")} · {activity.outcome?.replace("_", " ") ?? "note"}</strong>
                  <span className="subtle">{activity.user?.name ?? "Unknown"} · {formatDateTime(activity.created_at)}</span>
                  <p>{activity.note}</p>
                  {activity.next_follow_up_at ? <span className="subtle">Next follow-up: {formatDateTime(activity.next_follow_up_at)}</span> : null}
                </div>
              ))}
              {activities.length === 0 ? <p className="subtle">No activity logged yet.</p> : null}
            </div>
          </section>
        </div>

        <aside className="grid">
          <section className="panel">
            <h2>Log activity</h2>
            <p className="subtle">Salespeople can log only calls or WhatsApp touches. The available outcomes change by channel.</p>
            <ActivityForm leadId={lead.id} currentUser={currentUser} buyerType={lead.buyer_type} />
          </section>
          {currentUser.role === "admin" ? (
            <section className="panel">
              <h2>Conversion tracking</h2>
              <p className="subtle">Admins can manually record recovered Shopify orders by order ID, revenue, date, and owner.</p>
              <ConversionForm leadId={lead.id} users={users} />
            </section>
          ) : null}
          {currentUser.role === "admin" ? (
            <section className="panel">
              <h2>Order quality</h2>
              <p className="subtle">Use this when an order attempt looks fake, invalid, or should not count as recovered revenue.</p>
              <MarkFakeButton leadId={lead.id} />
            </section>
          ) : null}
          <section className="panel">
            <h2>Quick actions</h2>
            <div className="actions">
              <a className="button" href={`tel:${lead.phone}`}>Call</a>
              <a className="button" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank">WhatsApp</a>
              {lead.product_url ? <a className="button" href={lead.product_url} target="_blank">Product</a> : null}
            </div>
          </section>
          {currentUser.role === "admin" ? (
            <section className="panel">
              <h2>Assign lead</h2>
              <AssignLeadForm leadId={lead.id} users={users} assignedTo={lead.assigned_to} />
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
