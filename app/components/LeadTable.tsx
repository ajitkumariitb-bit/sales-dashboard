import Link from "next/link";
import { formatCurrency, formatDateTime } from "@/lib/date";
import { riskFlags } from "@/lib/metrics";
import type { Lead } from "@/lib/types";
import type { AppUser } from "@/lib/types";
import { AssignLeadForm } from "./AssignLeadForm";
import { FlagBadge, PriorityBadge, StageBadge, StatusBadge } from "./Badges";

export function LeadTable({
  leads,
  users,
  canAssign = false,
  recoveredRevenueByLead = {}
}: {
  leads: Lead[];
  users?: AppUser[];
  canAssign?: boolean;
  recoveredRevenueByLead?: Record<string, number>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th>Raw stage</th>
            <th>Priority</th>
            <th>Product</th>
            <th>Cart value</th>
            <th>Recovered</th>
            <th>Source</th>
            <th>Assigned</th>
            <th>Status</th>
            <th>Last contacted</th>
            <th>Next follow-up</th>
            <th>Touches</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const recoveredRevenue = recoveredRevenueByLead[lead.id] ?? 0;
            return (
            <tr key={lead.id}>
              <td>
                <strong>{lead.customer_name ?? "Unknown"}</strong>
                <div className="subtle">{lead.city ?? ""}{lead.state ? `, ${lead.state}` : ""}</div>
                <div className="badge-row">
                  {riskFlags(lead).map((flag) => (
                    <FlagBadge key={flag.label} {...flag} />
                  ))}
                </div>
              </td>
              <td>{lead.phone}</td>
              <td>
                <div>{lead.raw_stage ?? "Unknown"}</div>
                <StageBadge stage={lead.normalized_stage} />
              </td>
              <td><PriorityBadge priority={lead.priority} /></td>
              <td>{lead.product_names ?? "No product"}</td>
              <td>{formatCurrency(lead.cart_value)}</td>
              <td>
                {recoveredRevenue
                  ? formatCurrency(recoveredRevenue)
                  : lead.current_status === "converted"
                    ? "Linked recovery"
                    : "Not recovered"}
              </td>
              <td>
                {lead.source.replace("_", " ")}
                {lead.source_detail ? <div className="subtle">{lead.source_detail}</div> : null}
              </td>
              <td>
                {canAssign && users ? (
                  <AssignLeadForm leadId={lead.id} users={users} assignedTo={lead.assigned_to} />
                ) : (
                  lead.assigned_user?.name ?? "Unassigned"
                )}
              </td>
              <td><StatusBadge status={lead.current_status} /></td>
              <td>{formatDateTime(lead.last_contacted_at)}</td>
              <td>{formatDateTime(lead.next_follow_up_at)}</td>
              <td>{lead.total_touch_count}</td>
              <td><Link className="button" href={`/leads/${lead.id}`}>Open</Link></td>
            </tr>
            );
          })}
          {leads.length === 0 ? (
            <tr>
              <td colSpan={14}>No leads match these filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
