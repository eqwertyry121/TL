import type { Category, MenuItem, Order, Runtime } from "@tk-delivery/api-client/generated";

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
  createOrder(token: string, input: CreateOrderInput, idempotencyKey: string): Promise<Order>;
  getOrder(token: string, id: string): Promise<Order>;
  listOrders(token: string): Promise<{ orders: Order[] }>;
}

export interface CreateOrderInput {
  calculation_token: string;
  phone: string;
  address: string;
  comment: string;
  payment_method: "cash";
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
