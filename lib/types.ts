export type UserRole = "admin" | "salesperson";

export type LeadSource = "google_sheet" | "shiprocket_csv" | "manual" | "shopify_api";
export type NormalizedStage =
  | "INIT"
  | "Phone received"
  | "OTP verified"
  | "Address screen"
  | "Order screen"
  | "Payment initiated";
export type Priority = "P1 Hot" | "P2 Warm" | "P3 Nurture";
export type LeadStatus =
  | "new"
  | "contacted"
  | "connected"
  | "follow_up"
  | "converted"
  | "lost"
  | "not_reachable";
export type ActivityType = "call" | "whatsapp" | "note" | "status_change";
export type ActivityOutcome =
  | "connected"
  | "not_connected"
  | "switched_off"
  | "message_sent"
  | "message_delivered"
  | "message_read"
  | "customer_replied"
  | "callback_requested"
  | "interested"
  | "not_interested"
  | "price_issue"
  | "payment_issue"
  | "delivery_issue"
  | "wants_discount"
  | "converted"
  | "lost";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
};

export type Lead = {
  id: string;
  source: LeadSource;
  source_detail: string | null;
  raw_stage: string | null;
  normalized_stage: NormalizedStage;
  lead_score: number;
  priority: Priority;
  customer_name: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  buyer_type: string | null;
  product_names: string | null;
  product_url: string | null;
  checkout_url: string | null;
  recovery_url: string | null;
  cart_value: number | null;
  first_seen_at: string;
  assigned_to: string | null;
  current_status: LeadStatus;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  total_call_attempts: number;
  total_whatsapp_attempts: number;
  total_touch_count: number;
  created_at: string;
  updated_at: string;
  assigned_user?: AppUser | null;
};

export type Activity = {
  id: string;
  lead_id: string;
  user_id: string;
  activity_type: ActivityType;
  outcome: ActivityOutcome | null;
  note: string;
  next_follow_up_at: string | null;
  created_at: string;
  user?: AppUser | null;
};

export type RecoveredOrder = {
  id: string;
  lead_id: string;
  order_id: string;
  recovered_revenue: number;
  converted_by: string;
  converted_at: string;
};

export type FollowupTask = {
  id: string;
  lead_id: string;
  assigned_to: string;
  due_at: string;
  status: "pending" | "completed" | "missed";
  followup_number: number;
  created_at: string;
  completed_at: string | null;
};

export type LeadFilters = {
  phoneSearch?: string;
  priority?: string;
  rawStage?: string;
  normalizedStage?: string;
  source?: string;
  assignedTo?: string;
  status?: string;
  cityState?: string;
  cartMin?: number;
  cartMax?: number;
  dateFrom?: string;
  dateTo?: string;
  dueToday?: boolean;
  missedFollowup?: boolean;
  untouchedHot?: boolean;
};

export type ImportLeadInput = Partial<Lead> & {
  source: LeadSource;
  raw_stage?: string | null;
  phone: string;
};
