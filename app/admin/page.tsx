import Link from "next/link";
import { formatCurrency } from "@/lib/date";
import { dashboardMetrics, leaderboard } from "@/lib/metrics";
import { getActivities, getCurrentUser, getFollowups, getLeads, getRecoveredOrders, getUsers } from "@/lib/store";
import { LeadTable } from "../components/LeadTable";
import { StatCard } from "../components/StatCard";
import { redirect } from "next/navigation";
import { DedupeButton } from "../components/DedupeButton";
import { SyncPanel } from "../components/SyncPanel";

export default async function AdminDashboard() {
  const [currentUser, users, leads, activities, followups, orders] = await Promise.all([
    getCurrentUser(),
    getUsers(),
    getLeads(),
    getActivities(),
    getFollowups(),
    getRecoveredOrders()
  ]);
  if (currentUser.role !== "admin") redirect("/sales");
  const dashboardLeads = leads.filter((lead) => isWithinLastDays(lead.first_seen_at, 60));
  const dashboardLeadIds = new Set(dashboardLeads.map((lead) => lead.id));
  const dashboardActivities = activities.filter((activity) => dashboardLeadIds.has(activity.lead_id));
  const dashboardFollowups = followups.filter((followup) => dashboardLeadIds.has(followup.lead_id));
  const dashboardOrders = orders.filter((order) => dashboardLeadIds.has(order.lead_id));
  const metrics = dashboardMetrics({
    leads: dashboardLeads,
    activities: dashboardActivities,
    followups: dashboardFollowups,
    orders: dashboardOrders
  });
  const board = leaderboard({
    users,
    leads: dashboardLeads,
    activities: dashboardActivities,
    followups: dashboardFollowups,
    orders: dashboardOrders
  });
  const attentionLeads = dashboardLeads.filter((lead) => lead.priority === "P1 Hot" || !lead.next_follow_up_at).slice(0, 8);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Bliss & Birch recovery desk</h1>
          <p className="subtle">Track abandoned checkouts, showroom-style enquiries, salesperson follow-ups, and recovered revenue.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/leads">View all leads</Link>
          <Link className="button" href="/manual-leads">Create manual lead</Link>
          <Link className="button primary" href="/import">Import browser leads</Link>
        </div>
      </div>

      <SyncPanel />

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="section-head">
          <div>
            <h2>Duplicate cleanup</h2>
            <p className="subtle">Keeps the highest-score latest lead and moves activities, follow-ups, and recovered orders onto it.</p>
          </div>
        </div>
        <DedupeButton />
      </section>

      <section className="grid stats-grid">
        <StatCard label="Synced leads, 60 days" value={dashboardLeads.length} />
        <StatCard label="Total leads today" value={metrics.totalLeadsToday} />
        <StatCard label="P1 hot leads" value={metrics.p1Hot} />
        <StatCard label="P2 warm leads" value={metrics.p2Warm} />
        <StatCard label="P3 nurture leads" value={metrics.p3Nurture} />
        <StatCard label="Payment initiated" value={metrics.paymentInitiated} hint="Highest intent" />
        <StatCard label="Order screen" value={metrics.orderScreen} hint="Very high intent" />
        <StatCard label="Follow-ups due today" value={metrics.followupsDueToday} />
        <StatCard label="Missed follow-ups" value={metrics.missedFollowups} />
        <StatCard label="Untouched hot leads" value={metrics.untouchedHot} />
        <StatCard label="Calls attempted" value={metrics.callsAttempted} />
        <StatCard label="Connected calls" value={metrics.connectedCalls} />
        <StatCard label="WhatsApp attempts" value={metrics.whatsappAttempts} />
        <StatCard label="Conversions" value={metrics.conversions} />
        <StatCard label="Recovered revenue" value={formatCurrency(metrics.recoveredRevenue)} />
        <StatCard label="Conversion rate" value={`${metrics.conversionRate}%`} />
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="section-head">
          <div>
            <h2>Salesperson leaderboard</h2>
            <p className="subtle">Contact rate, follow-up discipline, and recovered revenue by owner.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Salesperson</th>
                <th>Assigned</th>
                <th>Contacted</th>
                <th>Contact rate</th>
                <th>Connected calls</th>
                <th>Follow-ups done</th>
                <th>Missed</th>
                <th>Conversions</th>
                <th>Revenue</th>
                <th>Conversion rate</th>
                <th>Avg. first contact</th>
                <th>Not-connected rate</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row) => (
                <tr key={row.user.id}>
                  <td><strong>{row.user.name}</strong></td>
                  <td>{row.assignedLeads}</td>
                  <td>{row.leadsContacted}</td>
                  <td>{row.contactRate}%</td>
                  <td>{row.connectedCalls}</td>
                  <td>{row.followupsCompleted}</td>
                  <td>{row.missedFollowups}</td>
                  <td>{row.conversions}</td>
                  <td>{formatCurrency(row.revenueRecovered)}</td>
                  <td>{row.conversionRate}%</td>
                  <td>{row.averageTimeToFirstContact === null ? "No data" : `${row.averageTimeToFirstContact} min`}</td>
                  <td>{row.notConnectedRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="section-head">
          <div>
            <h2>Needs attention</h2>
            <p className="subtle">High-intent product enquiries, missed follow-ups, WhatsApp-only touches, and open leads without a next step.</p>
          </div>
        </div>
        <LeadTable leads={attentionLeads} users={users} canAssign />
      </section>
    </>
  );
}

function isWithinLastDays(value: string, days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(value).getTime() >= cutoff;
}
