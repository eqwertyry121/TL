import type { Category, MenuItem, Order, OrderSummary, OrderSummaryPage, PaymentMethod, Runtime } from "@tk-delivery/api-client/generated";

export type Locale = "ru" | "sr" | "en";
export type Route =
  | { name: "menu" }
  | { name: "dish"; id: string }
  | { name: "add"; id: string }
  | { name: "cart" }
  | { name: "checkout" }
  | { name: "order"; id: string }
  | { name: "orders" }
  | { name: "support" }
  | { name: "terms" }
  | { name: "returns" }
  | { name: "privacy" };

export interface Session {
  token: string;
  telegram_user_id?: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
  active_role: "CLIENT";
  expires_at: string;
}

export interface CartLine {
  itemId: string;
  title: string;
  unitPriceMinor: number;
  quantity: number;
  menuVersion: number;
  updatedAt: string;
}

export interface CartState {
  version: 1;
  lines: Record<string, CartLine>;
}

export interface CalculationItem {
  item_id: string;
  title: string;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
  version: number;
}

export interface Calculation {
  calculation_token: string;
  items: CalculationItem[];
  subtotal_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  currency: "RSD";
  expires_at: string;
  order_subtotal_minor?: number;
  order_total_minor?: number;
}

export type CashLocationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED" | "USED";

export interface CashLocationChallenge {
  id: string;
  status: CashLocationStatus;
  rejection_reason?: string;
  distance_meters?: number;
  accuracy_meters?: number;
  expires_at: string;
  verified_at?: string;
  used_at?: string;
  bot_url?: string;
  dev_bypass?: boolean;
}

export interface VerifiedContact {
  verified: boolean;
  phone?: string;
  masked?: string;
  verified_at?: string;
}

export interface CheckoutDraft {
  phone: string;
  street: string;
  houseNumber: string;
  entrance: string;
  floor: string;
  apartment: string;
  comment: string;
}

export interface Api {
  mode: "real" | "demo";
  bootstrap(locale: Locale): Promise<ClientBootstrapData>;
  authenticate(locale: Locale): Promise<Session>;
  runtime(signal?: AbortSignal): Promise<Runtime>;
  menu(locale: Locale): Promise<{ categories: Category[] }>;
  calculate(token: string, items: Array<{ item_id: string; quantity: number }>): Promise<Calculation>;
  calculateAddition(token: string, orderId: string, items: Array<{ item_id: string; quantity: number }>): Promise<Calculation>;
  contact(token: string): Promise<VerifiedContact>;
  createCashLocationChallenge(token: string, input: { calculation_token: string; send_prompt?: boolean }): Promise<CashLocationChallenge>;
  getCashLocationChallenge(token: string, id: string, signal?: AbortSignal): Promise<CashLocationChallenge>;
  verifyCashLocationChallenge(
    token: string,
    id: string,
    input: { latitude: number; longitude: number; horizontal_accuracy?: number | null },
  ): Promise<CashLocationChallenge>;
  createOrder(token: string, input: CreateOrderInput, idempotencyKey: string): Promise<Order>;
  addOrderItems(token: string, orderId: string, input: AddOrderItemsInput, idempotencyKey: string): Promise<Order>;
  getOrder(token: string, id: string, signal?: AbortSignal): Promise<Order>;
  listOrders(token: string, filter?: { limit?: number; offset?: number }, signal?: AbortSignal): Promise<OrderSummaryPage>;
}

export interface ClientBootstrapData {
  session?: Session;
  roles?: string[];
  runtime: Runtime;
  runtime_revision?: number;
  categories: Category[];
  menu_revision?: number;
  orders: OrderSummary[];
  contact: VerifiedContact;
}

export interface CreateOrderInput {
  calculation_token: string;
  cash_location_challenge_id?: string;
  phone: string;
  address: string;
  comment: string;
  payment_method: Extract<PaymentMethod, "cash" | "crypto">;
  terms_accepted: boolean;
  locale: Locale;
}

export interface AddOrderItemsInput {
  calculation_token: string;
  expected_version: number;
}

export interface AppData {
  session: Session | null;
  runtime: Runtime | null;
  categories: Category[];
  orders: OrderSummary[];
}

export type ItemLookup = Map<string, MenuItem>;
