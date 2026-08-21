export type Role = "CLIENT" | "KITCHEN" | "COURIER" | "ADMIN";
export type FulfillmentStatus = "NEW" | "OUT_FOR_DELIVERY" | "READY_FOR_PICKUP" | "DELIVERED" | "CANCELLED";
export type FulfillmentType = "delivery" | "pickup";
export type PaymentMethod = "cash" | "card" | "crypto";
export type PaymentStatus = "CASH_PENDING" | "PAID" | "FAILED" | "REFUNDED";

export interface VersionInfo {
  service: string;
  build_sha: string;
  api_contract: string;
}

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
  terms_url: string;
  cash_location_required: boolean;
  cash_location_radius_meters: number;
  pickup_enabled: boolean;
  pickup_address: string;
  pickup_map_url: string;
  pickup_min_lead_minutes: number;
  pickup_slot_minutes: number;
  pickup_last_time: string;
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
  photo_variants?: PhotoVariants;
  weight_text: string;
  min_quantity: number;
  allergen_text: string;
  sort_order: number;
  version: number;
}

export interface PhotoVariants {
  thumbnail: PhotoVariant;
  display: PhotoVariant;
}

export interface PhotoVariant {
  url: string;
  width: number;
  height: number;
}

export interface Category {
  id: string;
  title: string;
  sort_order: number;
  items: MenuItem[];
}

export interface Session {
  token: string;
  telegram_user_id?: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
  active_role: Role;
  expires_at: string;
}

export interface VerifiedContact {
  verified: boolean;
  phone?: string;
  masked?: string;
  verified_at?: string;
}

export type ReservationStatus = "CONFIRMED" | "CANCELLED";

export interface Reservation {
  id: string;
  public_number: number;
  client_user_id?: string;
  client_username?: string;
  client_first_name?: string;
  table_id?: string;
  table_label: string;
  date: string;
  start_hour: number;
  end_hour: number;
  guests: number;
  status: "CONFIRMED" | "CANCELLED";
  locale: string;
  version: number;
  created_at: string;
  cancelled_at?: string;
}

export interface ReservationAvailability {
  timezone: "Europe/Belgrade";
  guests: number;
  days: Array<{ date: string; hours: number[] }>;
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
  photo_variants?: PhotoVariants;
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
  addition_id?: string;
  addition_revision?: number;
  addition_created_at?: string;
}

export interface OrderSummary {
  id: string;
  public_number: number;
  client_username?: string;
  client_first_name?: string;
  client_photo_url?: string;
  fulfillment_type: FulfillmentType;
  fulfillment_status: FulfillmentStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  currency: "RSD";
  locale: string;
  version: number;
  created_at: string;
  kitchen_started_at?: string;
  ready_at?: string;
  pickup_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  cash_location_verified_at?: string;
  cash_location_distance_meters?: number;
  can_add_items?: boolean;
  add_items_until?: string;
  add_items_reason?: string;
  latest_addition?: OrderAddition;
}

export interface OrderAddition {
  id: string;
  revision: number;
  subtotal_minor: number;
  currency: "RSD";
  created_at: string;
}

export interface Order extends OrderSummary {
  phone?: string;
  address?: string;
  customer_comment: string;
  pickup_original_at?: string;
  pickup_cook_at?: string;
  pickup_address?: string;
  pickup_instructions?: string;
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
  cash_location_required: boolean;
  restaurant_latitude: number;
  restaurant_longitude: number;
  cash_location_radius_meters: number;
  cash_location_ttl_seconds: number;
  cash_location_max_accuracy_meters: number;
  pickup_enabled: boolean;
  pickup_address: string;
  pickup_map_url: string;
  pickup_instructions_ru: string;
  pickup_instructions_sr: string;
  pickup_instructions_en: string;
  pickup_min_lead_minutes: number;
  pickup_slot_minutes: number;
  pickup_max_orders_per_slot: number;
  pickup_last_time: string;
  version: number;
  schedule?: ScheduleDay[];
}

export interface AdminDashboard {
  runtime: Runtime;
  new_orders: number;
  out_for_delivery: number;
  ready_for_pickup: number;
  orders_today: number;
  revenue_today_minor: number;
  notification_errors: string[];
  generated_at: string;
}

export interface PublicBootstrap {
  runtime: Runtime;
  runtime_revision: number;
  categories: Category[];
  menu_revision: number;
}

export interface ClientBootstrap extends PublicBootstrap {
  session?: Session;
  roles: Role[];
  orders: OrderSummary[];
  contact: VerifiedContact;
}

export interface OrderSummaryPage {
  orders: OrderSummary[];
  limit?: number;
  offset?: number;
  has_more?: boolean;
}

export interface AdminOrderCounts {
  active: number;
  new: number;
  ready: number;
  history: number;
}

export interface AdminOrdersPage extends OrderSummaryPage {
  counts?: AdminOrderCounts;
}

export interface StaffBootstrap {
  session: Session;
  roles: Role[];
  orders: Order[];
}

export interface AdminBootstrap {
  session: Session;
  roles: Role[];
  dashboard: AdminDashboard;
  menu?: {
    categories: AdminCategory[];
    items: AdminMenuItem[];
  };
  orders?: AdminOrdersPage;
  settings?: Settings;
  schedule?: {
    schedule: ScheduleDay[];
  };
  staff?: {
    staff: StaffMember[];
  };
  analytics?: AdminAnalytics;
  audit?: AuditLogResponse;
	reservations?: { reservations: Reservation[] };
}

export interface PerformanceBeacon {
  app: "client" | "kitchen" | "courier" | "admin";
  route: string;
  build: string;
  ttfb_ms?: number;
  lcp_ms?: number;
  cls?: number;
  inp_ms?: number;
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
  delivered_count: number;
  paid_count: number;
  cancelled_count: number;
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

export interface AuditLogResponse {
  entries: AuditEntry[];
  limit?: number;
  offset?: number;
  has_more?: boolean;
}
