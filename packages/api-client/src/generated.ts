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

export interface MenuItem {
  id: string;
  category_id: string;
  title: string;
  description: string;
  price_minor: number;
  currency: "RSD";
  photo_path: string;
  weight_text: string;
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
}
