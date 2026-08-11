import type { Category, MenuItem, Order, PaymentMethod, Runtime } from "@tk-delivery/api-client/generated";

export type Locale = "ru" | "sr" | "en";
export type Route =
  | { name: "menu" }
  | { name: "dish"; id: string }
  | { name: "cart" }
  | { name: "checkout" }
  | { name: "order"; id: string }
  | { name: "orders" }
  | { name: "support" }
  | { name: "terms" };

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
  details: string;
  comment: string;
}

export interface Api {
  mode: "real" | "demo";
  authenticate(locale: Locale): Promise<Session>;
  runtime(): Promise<Runtime>;
  menu(locale: Locale): Promise<{ categories: Category[] }>;
  calculate(token: string, items: Array<{ item_id: string; quantity: number }>): Promise<Calculation>;
  contact(token: string): Promise<VerifiedContact>;
  createCashLocationChallenge(token: string, input: { calculation_token: string }): Promise<CashLocationChallenge>;
  getCashLocationChallenge(token: string, id: string): Promise<CashLocationChallenge>;
  createOrder(token: string, input: CreateOrderInput, idempotencyKey: string): Promise<Order>;
  getOrder(token: string, id: string): Promise<Order>;
  listOrders(token: string): Promise<{ orders: Order[] }>;
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

export interface AppData {
  session: Session | null;
  runtime: Runtime | null;
  categories: Category[];
  orders: Order[];
}

export type ItemLookup = Map<string, MenuItem>;
