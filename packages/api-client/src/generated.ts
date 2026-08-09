export type Role = "CLIENT" | "KITCHEN" | "COURIER" | "ADMIN";
export type FulfillmentStatus = "NEW" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
export type PaymentMethod = "cash" | "card" | "crypto";
export type PaymentStatus = "CASH_PENDING" | "PAID" | "FAILED" | "REFUNDED";

export interface Runtime {
  server_time: string;
  timezone: "Europe/Belgrade";
  accepting_orders: boolean;
  reason: string;
  next_opening?: string;
  day_off_banner: string;
  flat_delivery_fee_minor: number;
  currency: "RSD";
  enabled_payments: PaymentMethod[];
  supported_locales: Array<"ru" | "sr" | "en">;
  support_text: string;
}

export interface ScheduleDay {
  day_of_week: number;
  closed: boolean;
  open_time: string;
  order_cutoff_time: string;
  close_time: string;
  version?: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  title: string;
  description: string;
  price_minor: number;
  currency: "RSD";
  photo_path: string;
  weight_text: string;
  min_quantity: number;
  allergen_text: string;
  sort_order: number;
  version: number;
}

export interface Category {
  id: string;
  title: string;
  sort_order: number;
  items: MenuItem[];
}

export interface AdminCategory {
  id: string;
  title_ru: string;
  title_sr: string;
  title_en: string;
  sort_order: number;
  visible: boolean;
  archived: boolean;
  item_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AdminMenuItem {
  id: string;
  category_id: string;
  title_ru: string;
  title_sr: string;
  title_en: string;
  description_ru: string;
  description_sr: string;
  description_en: string;
  price_minor: number;
  currency: "RSD";
  photo_path: string;
  weight_text: string;
  min_quantity: number;
  allergen_text_ru: string;
  allergen_text_sr: string;
  allergen_text_en: string;
  sort_order: number;
  visible: boolean;
  archived: boolean;
  used_in_orders: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  menu_item_id: string;
  snapshot_title: string;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
}

export interface Order {
  id: string;
  public_number: number;
  client_username?: string;
  client_first_name?: string;
  client_photo_url?: string;
  fulfillment_status: FulfillmentStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  currency: "RSD";
  phone?: string;
  address?: string;
  customer_comment: string;
  locale: string;
  version: number;
  created_at: string;
  ready_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  items: OrderItem[];
  events?: OrderEvent[];
}

export interface OrderEvent {
  id: string;
  order_id: string;
  from_status: string;
  to_status: string;
  action: string;
  actor_role: string;
  reason: string;
  created_at: string;
}

export interface StaffMember {
  id: string;
  telegram_user_id: number;
  display_label: string;
  role: Exclude<Role, "CLIENT">;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  timezone: "Europe/Belgrade";
  currency: "RSD";
  manual_day_off: boolean;
  day_off_banner: string;
  flat_delivery_fee_minor: number;
  support_text: string;
  support_phone: string;
  terms_url: string;
  max_item_quantity: number;
  max_comment_length: number;
  cash_enabled: boolean;
  card_enabled: boolean;
  crypto_enabled: boolean;
  version: number;
  schedule?: ScheduleDay[];
}

export interface AdminDashboard {
  runtime: Runtime;
  new_orders: number;
  out_for_delivery: number;
  orders_today: number;
  revenue_today_minor: number;
  notification_errors: string[];
  generated_at: string;
}

export interface AnalyticsSummary {
  all_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  revenue_minor: number;
  average_check_minor: number;
}

export interface AnalyticsBreakdown {
  key: string;
  count: number;
  revenue_minor: number;
}

export interface TopDish {
  title: string;
  quantity: number;
  revenue_minor: number;
}

export interface DailyAnalyticsRow {
  day: string;
  orders: number;
  delivered: number;
  cancelled: number;
  revenue_minor: number;
}

export interface AdminAnalytics {
  currency: "RSD";
  from: string;
  to: string;
  generated_at: string;
  summary: AnalyticsSummary;
  statuses: AnalyticsBreakdown[];
  payments: AnalyticsBreakdown[];
  top_dishes: TopDish[];
  daily_rows: DailyAnalyticsRow[];
}

export interface AuditEntry {
  id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id?: string;
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  created_at: string;
}
