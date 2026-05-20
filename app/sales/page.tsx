import Link from "next/link";
import { isPast, isToday } from "@/lib/date";
import { getCurrentUser, getLeads } from "@/lib/store";
import { PriorityBadge, StageBadge, StatusBadge } from "../components/Badges";

function LeadCard({ lead }: { lead: Awaited<ReturnType<typeof getLeads>>[number] }) {
  return (
    <Link className="card lead-mini" href={`/leads/${lead.id}`}>
      <div className="badge-row">
        <PriorityBadge priority={lead.priority} />
        <StageBadge stage={lead.normalized_stage} />
      </div>
      <strong>{lead.customer_name ?? "Unknown"} · {lead.phone}</strong>
      <span className="subtle">{lead.product_names ?? "No product"} · {lead.total_touch_count} touches</span>
      <StatusBadge status={lead.current_status} />
    </Link>
  );
}

function Section({ title, leads }: { title: string; leads: Awaited<ReturnType<typeof getLeads>> }) {
  return (
    <section className="panel">
      <div className="section-head">
        <h2>{title}</h2>
        <span className="badge status">{leads.length}</span>
      </div>
      <div className="grid">
        {leads.slice(0, 6).map((lead) => <LeadCard key={lead.id} lead={lead} />)}
        {leads.length === 0 ? <p className="subtle">Nothing waiting here.</p> : null}
      </div>
    </section>
  );
}

export default async function SalespersonDashboard() {
  const user = await getCurrentUser();
  const leads = await getLeads({}, user);
  const open = leads.filter((lead) => !["converted", "lost"].includes(lead.current_status));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Salesperson</div>
          <h1>{user.name}'s recovery queue</h1>
          <p className="subtle">Only assigned leads are shown. INIT leads are hidden by default.</p>
        </div>
        <Link className="button primary" href="/leads">Open lead list</Link>
      </div>

      <div className="kanban">
        <Section title="Hot leads to call now" leads={open.filter((lead) => lead.priority === "P1 Hot" && !lead.last_contacted_at)} />
        <Section title="Follow-ups due today" leads={open.filter((lead) => isToday(lead.next_follow_up_at))} />
        <Section title="Missed follow-ups" leads={open.filter((lead) => isPast(lead.next_follow_up_at))} />
        <Section title="New assigned leads" leads={open.filter((lead) => lead.current_status === "new")} />
        <Section title="Warm leads" leads={open.filter((lead) => lead.priority === "P2 Warm")} />
        <Section title="Browser nurture leads" leads={leads.filter((lead) => lead.source === "shiprocket_csv")} />
        <Section title="Converted leads" leads={leads.filter((lead) => lead.current_status === "converted")} />
      </div>
    </>
  );
}
