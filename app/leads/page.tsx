import { recoveredRevenueByLead } from "@/lib/recovery";
import { getCurrentUser, getLeads, getLeadsResult, getRecoveredOrders, getUsers } from "@/lib/store";
import { BulkAssignForm } from "../components/AssignLeadForm";
import { LeadTable } from "../components/LeadTable";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] : item;
}

function numberValue(params: Record<string, string | string[] | undefined>, key: string) {
  const item = value(params, key);
  if (!item) return undefined;
  const number = Number(item);
  return Number.isFinite(number) ? number : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [currentUser, users, allLeads, recoveredOrders] = await Promise.all([
    getCurrentUser(),
    getUsers(),
    getLeads(),
    getRecoveredOrders()
  ]);
  const filters = {
    phoneSearch: value(params, "phoneSearch"),
    priority: value(params, "priority"),
    rawStage: value(params, "rawStage"),
    normalizedStage: value(params, "normalizedStage"),
    source: value(params, "source"),
    assignedTo: value(params, "assignedTo"),
    status: value(params, "status"),
    cityState: value(params, "cityState"),
    cartMin: numberValue(params, "cartMin"),
    cartMax: numberValue(params, "cartMax"),
    dateFrom: value(params, "dateFrom"),
    dateTo: value(params, "dateTo"),
    dueToday: value(params, "dueToday") === "on",
    missedFollowup: value(params, "missedFollowup") === "on",
    untouchedHot: value(params, "untouchedHot") === "on"
  };
  const page = Math.max(1, Number(value(params, "page") ?? 1) || 1);
  const leadResult = await getLeadsResult(filters, currentUser.role === "salesperson" ? currentUser : undefined, {
    page,
    pageSize: 100
  });
  const leads = leadResult.leads;
  const recoveredRevenue = recoveredRevenueByLead(recoveredOrders);
  const totalPages = Math.max(1, Math.ceil(leadResult.total / leadResult.pageSize));
  const makePageHref = (nextPage: number) => {
    const search = new URLSearchParams();
    for (const [key, raw] of Object.entries(params)) {
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (item && key !== "page") search.set(key, item);
    }
    search.set("page", String(nextPage));
    return `/leads?${search.toString()}`;
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Lead list</div>
          <h1>Recovery leads</h1>
          <p className="subtle">Filter by intent, source, owner, status, location, follow-up health, or untouched hot leads.</p>
        </div>
      </div>

      {currentUser.role === "admin" ? <BulkAssignForm users={users} /> : null}

      <form className="panel" style={{ marginBottom: 16 }}>
        <div className="filters">
          <label className="field">
            <span>Phone number</span>
            <input name="phoneSearch" inputMode="numeric" defaultValue={filters.phoneSearch ?? ""} />
          </label>
          <label className="field">
            <span>Priority</span>
            <select name="priority" defaultValue={filters.priority ?? ""}>
              <option value="">All</option>
              <option>P1 Hot</option>
              <option>P2 Warm</option>
              <option>P3 Nurture</option>
            </select>
          </label>
          <label className="field">
            <span>Raw stage</span>
            <input name="rawStage" defaultValue={filters.rawStage ?? ""} />
          </label>
          <label className="field">
            <span>Normalized stage</span>
            <select name="normalizedStage" defaultValue={filters.normalizedStage ?? ""}>
              <option value="">All</option>
              <option>Payment initiated</option>
              <option>Order screen</option>
              <option>Address screen</option>
              <option>OTP verified</option>
              <option>Phone received</option>
              <option>INIT</option>
            </select>
          </label>
          <label className="field">
            <span>Source</span>
            <select name="source" defaultValue={filters.source ?? ""}>
              <option value="">All</option>
              <option value="google_sheet">Google Sheet</option>
              <option value="shiprocket_csv">Shiprocket CSV</option>
              <option value="manual">Manual</option>
              <option value="shopify_api">Shopify API</option>
            </select>
          </label>
          <label className="field">
            <span>Assigned</span>
            <select name="assignedTo" defaultValue={filters.assignedTo ?? ""}>
              <option value="">All</option>
              {users.filter((user) => user.role === "salesperson").map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="connected">Connected</option>
              <option value="follow_up">Follow up</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
              <option value="not_reachable">Not reachable</option>
            </select>
          </label>
          <label className="field">
            <span>City/state</span>
            <input name="cityState" defaultValue={filters.cityState ?? ""} />
          </label>
          <label className="field">
            <span>Cart value min</span>
            <input name="cartMin" type="number" min="0" defaultValue={filters.cartMin ?? ""} />
          </label>
          <label className="field">
            <span>Cart value max</span>
            <input name="cartMax" type="number" min="0" defaultValue={filters.cartMax ?? ""} />
          </label>
          <label className="field">
            <span>Created from</span>
            <input name="dateFrom" type="date" defaultValue={filters.dateFrom ?? ""} />
          </label>
          <label className="field">
            <span>Created to</span>
            <input name="dateTo" type="date" defaultValue={filters.dateTo ?? ""} />
          </label>
          <label className="field">
            <span>Due today</span>
            <select name="dueToday" defaultValue={filters.dueToday ? "on" : ""}>
              <option value="">No</option>
              <option value="on">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Missed follow-up</span>
            <select name="missedFollowup" defaultValue={filters.missedFollowup ? "on" : ""}>
              <option value="">No</option>
              <option value="on">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Untouched hot</span>
            <select name="untouchedHot" defaultValue={filters.untouchedHot ? "on" : ""}>
              <option value="">No</option>
              <option value="on">Yes</option>
            </select>
          </label>
        </div>
        <div className="actions">
          <button className="button primary" type="submit">Apply filters</button>
          <a className="button" href="/leads">Clear</a>
        </div>
      </form>

      <div className="section-head">
        <p className="subtle">
          Showing {(leadResult.page - 1) * leadResult.pageSize + (leads.length ? 1 : 0)}-
          {(leadResult.page - 1) * leadResult.pageSize + leads.length} of {leadResult.total} leads
        </p>
        <div className="actions">
          {leadResult.page > 1 ? <a className="button" href={makePageHref(leadResult.page - 1)}>Previous</a> : null}
          <span className="subtle">Page {leadResult.page} of {totalPages}</span>
          {leadResult.page < totalPages ? <a className="button" href={makePageHref(leadResult.page + 1)}>Next</a> : null}
        </div>
      </div>

      <LeadTable
        leads={leads}
        users={users}
        canAssign={currentUser.role === "admin"}
        recoveredRevenueByLead={recoveredRevenue}
      />
    </>
  );
}
