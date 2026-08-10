import type {
  AdminAnalytics,
  AdminCategory,
  AdminDashboard,
  AdminMenuItem,
  AuditEntry,
  Order,
  Role,
  ScheduleDay,
  Settings,
  StaffMember,
} from "@tk-delivery/api-client/generated";

const demoOrdersKey = "tk-client-demo-orders-v1";
const demoMenuKey = "tk-admin-demo-menu-v1";
const demoSettingsKey = "tk-admin-demo-settings-v1";
const demoStaffKey = "tk-admin-demo-staff-v1";
const demoAuditKey = "tk-admin-demo-audit-v1";

export type AdminTab = "home" | "menu" | "orders" | "staff" | "schedule" | "analytics" | "settings" | "audit";
export type StaffRole = Exclude<Role, "CLIENT">;
export type AnalyticsRange = "today" | "7d" | "month";

export interface AdminSession {
  token: string;
  telegram_user_id?: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
  active_role: "ADMIN";
  expires_at: string;
}

export interface AdminMenuResponse {
  categories: AdminCategory[];
  items: AdminMenuItem[];
}

export interface CategoryInput {
  title_ru: string;
  title_sr: string;
  title_en: string;
  sort_order: number;
  visible: boolean;
  version: number;
}

export interface MenuItemInput {
  category_id: string;
  title_ru: string;
  title_sr: string;
  title_en: string;
  description_ru: string;
  description_sr: string;
  description_en: string;
  price_minor: number;
  photo_path: string;
  weight_text: string;
  min_quantity: number;
  allergen_text_ru: string;
  allergen_text_sr: string;
  allergen_text_en: string;
  sort_order: number;
  visible: boolean;
  version: number;
}

export interface SettingsInput {
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
}

export interface StaffInput {
  telegram_user_id?: number;
  display_label: string;
  role: StaffRole;
  active: boolean;
}

export interface AdminApi {
  mode: "real" | "demo";
  authenticate(): Promise<AdminSession>;
  dashboard(token: string): Promise<AdminDashboard>;
  menu(token: string): Promise<AdminMenuResponse>;
  createCategory(token: string, input: CategoryInput): Promise<AdminCategory>;
  updateCategory(token: string, id: string, input: CategoryInput): Promise<AdminCategory>;
  archiveCategory(token: string, id: string, reason: string): Promise<AdminCategory>;
  restoreCategory(token: string, id: string, reason: string): Promise<AdminCategory>;
  deleteCategory(token: string, id: string, reason: string): Promise<{ result: string }>;
  createItem(token: string, input: MenuItemInput): Promise<AdminMenuItem>;
  updateItem(token: string, id: string, input: MenuItemInput): Promise<AdminMenuItem>;
  archiveItem(token: string, id: string, reason: string): Promise<AdminMenuItem>;
  restoreItem(token: string, id: string, reason: string): Promise<AdminMenuItem>;
  deleteItem(token: string, id: string, reason: string): Promise<{ result: string }>;
  settings(token: string): Promise<Settings>;
  updateSettings(token: string, input: SettingsInput): Promise<Settings>;
  setManualDayOff(token: string, enabled: boolean): Promise<Settings>;
  schedule(token: string): Promise<{ schedule: ScheduleDay[] }>;
  updateSchedule(token: string, schedule: ScheduleDay[]): Promise<{ schedule: ScheduleDay[] }>;
  orders(token: string, filter?: { status?: string; q?: string; date?: string }): Promise<{ orders: Order[] }>;
  cancelOrder(token: string, id: string, reason: string): Promise<Order>;
  returnOrderToNew(token: string, id: string, reason: string): Promise<Order>;
  updateOrderContact(token: string, id: string, input: { phone: string; address: string; reason: string }): Promise<Order>;
  resendOrder(token: string, id: string, recipient: "client" | "courier", reason: string): Promise<{ ok: boolean }>;
  addOrderNote(token: string, id: string, reason: string): Promise<{ ok: boolean }>;
  staff(token: string): Promise<{ staff: StaffMember[] }>;
  addStaff(token: string, input: StaffInput & { telegram_user_id: number }): Promise<StaffMember>;
  updateStaff(token: string, id: string, input: StaffInput): Promise<StaffMember>;
  analytics(token: string, range: AnalyticsRange): Promise<AdminAnalytics>;
  audit(token: string): Promise<{ entries: AuditEntry[] }>;
  uploadMenuPhoto(token: string, file: File): Promise<{ photo_path: string }>;
}

export function createAdminApi(): AdminApi {
  const env = runtimeEnv();
  const appEnv = stringEnv(env.VITE_APP_ENV) || (env.PROD ? "production" : "development");
  const demoMode = env.VITE_DEMO_MODE === "true" && appEnv !== "production";
  const baseURL = stringEnv(env.VITE_API_BASE_URL);
  if (demoMode || (appEnv !== "production" && !baseURL)) return demoApi();
  if (!baseURL) return unconfiguredApi();
  return realApi(baseURL, appEnv);
}

export function money(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " RSD";
}

export function statusText(status: Order["fulfillment_status"]): string {
  switch (status) {
    case "NEW":
      return "Новый";
    case "OUT_FOR_DELIVERY":
      return "В доставке";
    case "DELIVERED":
      return "Доставлен";
    case "CANCELLED":
      return "Отменён";
  }
}

function realApi(baseURL: string, appEnv: string): AdminApi {
  return {
    mode: "real",
    async authenticate() {
      const response =
        appEnv === "production"
          ? await post(`${baseURL}/api/v1/auth/telegram`, {
              audience: "staff",
              role: "ADMIN",
              init_data: rawInitData(),
            })
          : await post(`${baseURL}/api/v1/dev/session`, { telegram_user_id: 1048084234, role: "ADMIN" });
      return response.session;
    },
    dashboard: (token) => get(`${baseURL}/api/v1/admin/dashboard`, token),
    menu: (token) => get(`${baseURL}/api/v1/admin/menu`, token),
    createCategory: (token, input) => post(`${baseURL}/api/v1/admin/categories`, input, token),
    updateCategory: (token, id, input) => put(`${baseURL}/api/v1/admin/categories/${id}`, input, token),
    archiveCategory: (token, id, reason) => post(`${baseURL}/api/v1/admin/categories/${id}/archive`, { reason }, token),
    restoreCategory: (token, id, reason) => post(`${baseURL}/api/v1/admin/categories/${id}/restore`, { reason }, token),
    deleteCategory: (token, id, reason) => del(`${baseURL}/api/v1/admin/categories/${id}?reason=${encodeURIComponent(reason)}`, token),
    createItem: (token, input) => post(`${baseURL}/api/v1/admin/items`, input, token),
    updateItem: (token, id, input) => put(`${baseURL}/api/v1/admin/items/${id}`, input, token),
    archiveItem: (token, id, reason) => post(`${baseURL}/api/v1/admin/items/${id}/archive`, { reason }, token),
    restoreItem: (token, id, reason) => post(`${baseURL}/api/v1/admin/items/${id}/restore`, { reason }, token),
    deleteItem: (token, id, reason) => del(`${baseURL}/api/v1/admin/items/${id}?reason=${encodeURIComponent(reason)}`, token),
    settings: (token) => get(`${baseURL}/api/v1/admin/settings`, token),
    updateSettings: (token, input) => put(`${baseURL}/api/v1/admin/settings`, input, token),
    setManualDayOff: (token, enabled) => put(`${baseURL}/api/v1/admin/settings/manual-day-off`, { enabled }, token),
    schedule: (token) => get(`${baseURL}/api/v1/admin/schedule`, token),
    updateSchedule: (token, schedule) => put(`${baseURL}/api/v1/admin/schedule`, { schedule }, token),
    orders: (token, filter = {}) => get(`${baseURL}/api/v1/admin/orders?${new URLSearchParams(clean(filter))}`, token),
    cancelOrder: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/cancel`, { reason }, token),
    returnOrderToNew: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/return-to-new`, { reason }, token),
    updateOrderContact: (token, id, input) => put(`${baseURL}/api/v1/admin/orders/${id}/contact`, input, token),
    resendOrder: (token, id, recipient, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/resend`, { recipient, reason }, token),
    addOrderNote: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/note`, { reason }, token),
    staff: (token) => get(`${baseURL}/api/v1/admin/staff`, token),
    addStaff: (token, input) => post(`${baseURL}/api/v1/admin/staff`, input, token),
    updateStaff: (token, id, input) => put(`${baseURL}/api/v1/admin/staff/${id}`, input, token),
    analytics: (token, range) => get(`${baseURL}/api/v1/admin/analytics?range=${range}`, token),
    audit: (token) => get(`${baseURL}/api/v1/admin/audit`, token),
    async uploadMenuPhoto(token, file) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${baseURL}/api/v1/admin/uploads/menu-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      return read(response);
    },
  };
}

function demoApi(): AdminApi {
  ensureDemoSeed();
  return {
    mode: "demo",
    async authenticate() {
      return {
        token: "demo-admin-token",
        telegram_user_id: 1048084234,
        active_role: "ADMIN",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    },
    async dashboard() {
      const settings = loadSettings();
      const orders = loadOrders();
      return {
        runtime: runtimeFromSettings(settings),
        new_orders: orders.filter((order) => order.fulfillment_status === "NEW").length,
        out_for_delivery: orders.filter((order) => order.fulfillment_status === "OUT_FOR_DELIVERY").length,
        orders_today: orders.filter((order) => isToday(order.created_at)).length,
        revenue_today_minor: orders
          .filter((order) => isToday(order.created_at) && order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID")
          .reduce((sum, order) => sum + order.total_minor, 0),
        notification_errors: [],
        generated_at: new Date().toISOString(),
      };
    },
    async menu() {
      return loadMenu();
    },
    async createCategory(_token, input) {
      const menu = loadMenu();
      const category = categoryFromInput(input, crypto.randomUUID());
      menu.categories.push(category);
      saveMenu(menu);
      pushAudit("category.create", "category", category.id, "", undefined, { title_ru: category.title_ru });
      return category;
    },
    async updateCategory(_token, id, input) {
      const menu = loadMenu();
      const index = menu.categories.findIndex((category) => category.id === id);
      const before = menu.categories[index];
      if (!before || before.version !== input.version) throw apiError("ORDER_STATUS_CONFLICT");
      const after = { ...categoryFromInput(input, id), version: before.version + 1, created_at: before.created_at, updated_at: nowISO() };
      menu.categories[index] = after;
      saveMenu(menu);
      pushAudit("category.update", "category", id, "", before, after);
      return after;
    },
    async archiveCategory(_token, id, reason) {
      const menu = loadMenu();
      const category = mustFind(menu.categories, id);
      const before = { ...category };
      category.visible = false;
      category.archived = true;
      category.version += 1;
      category.updated_at = nowISO();
      saveMenu(menu);
      pushAudit("category.archive", "category", id, reason, before, category);
      return category;
    },
    async restoreCategory(_token, id, reason) {
      const menu = loadMenu();
      const category = mustFind(menu.categories, id);
      const before = { ...category };
      category.visible = true;
      category.archived = false;
      category.version += 1;
      category.updated_at = nowISO();
      saveMenu(menu);
      pushAudit("category.restore", "category", id, reason, before, category);
      return category;
    },
    async deleteCategory(_token, id, reason) {
      const menu = loadMenu();
      const hasItems = menu.items.some((item) => item.category_id === id);
      if (!hasItems) {
        saveMenu({ ...menu, categories: menu.categories.filter((category) => category.id !== id) });
        pushAudit("category.delete", "category", id, reason);
        return { result: "deleted" };
      }
      const category = mustFind(menu.categories, id);
      const before = { ...category };
      category.visible = false;
      category.archived = true;
      category.version += 1;
      category.updated_at = nowISO();
      saveMenu(menu);
      pushAudit("category.archive", "category", id, reason, before, category);
      return { result: "archived" };
    },
    async createItem(_token, input) {
      const menu = loadMenu();
      const item = itemFromInput(input, crypto.randomUUID());
      menu.items.push(item);
      refreshCategoryCounts(menu);
      saveMenu(menu);
      pushAudit("menu_item.create", "menu_item", item.id, "", undefined, { title_ru: item.title_ru, price_minor: item.price_minor });
      return item;
    },
    async updateItem(_token, id, input) {
      const menu = loadMenu();
      const index = menu.items.findIndex((item) => item.id === id);
      const before = menu.items[index];
      if (!before || before.version !== input.version) throw apiError("ORDER_STATUS_CONFLICT");
      const after = { ...itemFromInput(input, id), version: before.version + 1, used_in_orders: before.used_in_orders, created_at: before.created_at, updated_at: nowISO() };
      menu.items[index] = after;
      refreshCategoryCounts(menu);
      saveMenu(menu);
      pushAudit(before.price_minor === after.price_minor ? "menu_item.update" : "menu_item.price_change", "menu_item", id, "", before, after);
      return after;
    },
    async archiveItem(_token, id, reason) {
      const menu = loadMenu();
      const item = mustFind(menu.items, id);
      const before = { ...item };
      item.visible = false;
      item.archived = true;
      item.version += 1;
      item.updated_at = nowISO();
      refreshCategoryCounts(menu);
      saveMenu(menu);
      pushAudit("menu_item.archive", "menu_item", id, reason, before, item);
      return item;
    },
    async restoreItem(_token, id, reason) {
      const menu = loadMenu();
      const item = mustFind(menu.items, id);
      const before = { ...item };
      item.visible = true;
      item.archived = false;
      item.version += 1;
      item.updated_at = nowISO();
      refreshCategoryCounts(menu);
      saveMenu(menu);
      pushAudit("menu_item.restore", "menu_item", id, reason, before, item);
      return item;
    },
    async deleteItem(_token, id, reason) {
      const menu = loadMenu();
      const item = mustFind(menu.items, id);
      if (!item.used_in_orders) {
        saveMenu({ ...menu, items: menu.items.filter((entry) => entry.id !== id) });
        pushAudit("menu_item.delete", "menu_item", id, reason);
        return { result: "deleted" };
      }
      const before = { ...item };
      item.visible = false;
      item.archived = true;
      item.version += 1;
      item.updated_at = nowISO();
      saveMenu(menu);
      pushAudit("menu_item.archive", "menu_item", id, reason, before, item);
      return { result: "archived" };
    },
    async settings() {
      return loadSettings();
    },
    async updateSettings(_token, input) {
      if (input.card_enabled || input.crypto_enabled || !input.cash_enabled) throw apiError("INVALID_INPUT");
      const before = loadSettings();
      if (before.version !== input.version) throw apiError("ORDER_STATUS_CONFLICT");
      const after: Settings = { ...before, ...input, card_enabled: false, crypto_enabled: false, version: before.version + 1 };
      saveSettings(after);
      pushAudit("settings.update", "app_settings", undefined, "", before, after);
      return after;
    },
    async setManualDayOff(_token, enabled) {
      const before = loadSettings();
      const after = { ...before, manual_day_off: enabled, version: before.version + 1 };
      saveSettings(after);
      pushAudit("settings.manual_day_off", "app_settings", undefined, "", { manual_day_off: before.manual_day_off }, { manual_day_off: enabled });
      window.dispatchEvent(new StorageEvent("storage", { key: demoSettingsKey }));
      return after;
    },
    async schedule() {
      return { schedule: loadSettings().schedule || defaultSchedule() };
    },
    async updateSchedule(_token, schedule) {
      const before = loadSettings();
      const after = { ...before, schedule: schedule.map((day) => ({ ...day, version: (day.version || 1) + 1 })), version: before.version + 1 };
      saveSettings(after);
      pushAudit("schedule.update", "restaurant_schedule", undefined, "", { schedule: before.schedule }, { schedule: after.schedule });
      window.dispatchEvent(new StorageEvent("storage", { key: demoSettingsKey }));
      return { schedule: after.schedule || defaultSchedule() };
    },
    async orders(_token, filter = {}) {
      let orders = loadOrders();
      if (filter.status) orders = orders.filter((order) => order.fulfillment_status === filter.status);
      if (filter.q) orders = orders.filter((order) => String(order.public_number).includes(filter.q || "") || (order.phone || "").includes(filter.q || ""));
      if (filter.date) orders = orders.filter((order) => order.created_at.slice(0, 10) === filter.date);
      return { orders };
    },
    async cancelOrder(_token, id, reason) {
      return mutateOrder(id, reason, (order) => ({ ...order, fulfillment_status: "CANCELLED", payment_status: order.payment_status === "CASH_PENDING" ? "FAILED" : order.payment_status, cancelled_at: nowISO(), version: order.version + 1 }));
    },
    async returnOrderToNew(_token, id, reason) {
      return mutateOrder(id, reason, (order) => ({ ...order, fulfillment_status: "NEW", ready_at: undefined, version: order.version + 1 }));
    },
    async updateOrderContact(_token, id, input) {
      return mutateOrder(id, input.reason, (order) => ({ ...order, phone: input.phone, address: input.address, version: order.version + 1 }));
    },
    async resendOrder(_token, id, recipient, reason) {
      pushAudit("order.resend_notification", "order", id, reason, undefined, { recipient });
      return { ok: true };
    },
    async addOrderNote(_token, id, reason) {
      pushAudit("order.note", "order", id, reason);
      return { ok: true };
    },
    async staff() {
      return { staff: loadStaff() };
    },
    async addStaff(_token, input) {
      const staff = loadStaff();
      if (input.role === "COURIER" && input.active && staff.some((member) => member.role === "COURIER" && member.active)) throw apiError("INVALID_INPUT");
      const member = staffFromInput(input, crypto.randomUUID());
      saveStaff([...staff, member]);
      pushAudit("staff.create", "staff", member.id, "", undefined, member);
      return member;
    },
    async updateStaff(_token, id, input) {
      const staff = loadStaff();
      const index = staff.findIndex((member) => member.id === id);
      const before = staff[index];
      if (!before) throw apiError("INVALID_INPUT");
      if (before.role === "ADMIN" && before.active && !input.active && staff.filter((member) => member.role === "ADMIN" && member.active && member.id !== id).length === 0) throw apiError("INVALID_INPUT");
      if (input.role === "COURIER" && input.active && staff.some((member) => member.role === "COURIER" && member.active && member.id !== id)) throw apiError("INVALID_INPUT");
      const after = { ...before, ...input, updated_at: nowISO() };
      staff[index] = after;
      saveStaff(staff);
      pushAudit("staff.update", "staff", id, "", before, after);
      return after;
    },
    async analytics(_token, range) {
      return calculateAnalytics(range);
    },
    async audit() {
      return { entries: loadAudit() };
    },
    async uploadMenuPhoto(_token, file) {
      return { photo_path: URL.createObjectURL(file) };
    },
  };
}

function unconfiguredApi(): AdminApi {
  const fail = async () => {
    throw apiError("SERVER_UNAVAILABLE");
  };
  return {
    mode: "real",
    authenticate: fail as () => Promise<AdminSession>,
    dashboard: fail,
    menu: fail,
    createCategory: fail,
    updateCategory: fail,
    archiveCategory: fail,
    restoreCategory: fail,
    deleteCategory: fail,
    createItem: fail,
    updateItem: fail,
    archiveItem: fail,
    restoreItem: fail,
    deleteItem: fail,
    settings: fail,
    updateSettings: fail,
    setManualDayOff: fail,
    schedule: fail,
    updateSchedule: fail,
    orders: fail,
    cancelOrder: fail,
    returnOrderToNew: fail,
    updateOrderContact: fail,
    resendOrder: fail,
    addOrderNote: fail,
    staff: fail,
    addStaff: fail,
    updateStaff: fail,
    analytics: fail,
    audit: fail,
    uploadMenuPhoto: fail,
  };
}

async function get(url: string, token?: string) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return read(response);
}

async function post(url: string, body: unknown, token?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return read(response);
}

async function put(url: string, body: unknown, token?: string) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return read(response);
}

async function del(url: string, token?: string) {
  const response = await fetch(url, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return read(response);
}

async function read(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload?.error?.code || "SERVER_UNAVAILABLE");
  return payload;
}

function runtimeEnv(): Record<string, string | boolean | undefined> {
  return ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {});
}

function stringEnv(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function rawInitData(): string {
  return window.Telegram?.WebApp?.initData || "";
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
      };
    };
  }
}

function ensureDemoSeed(): void {
  if (!localStorage.getItem(demoMenuKey)) saveMenu(seedMenu());
  else saveMenu(normalizeDemoMenu(loadMenu()));
  if (!localStorage.getItem(demoSettingsKey)) saveSettings(seedSettings());
  if (!localStorage.getItem(demoStaffKey)) saveStaff(seedStaff());
  if (!localStorage.getItem(demoAuditKey)) saveAudit([]);
}

function seedMenu(): AdminMenuResponse {
  const now = nowISO();
  const categories: AdminCategory[] = [
    categorySeed("11111111-1111-1111-1111-111111111001", "Хинкали", "Hinkali", "Khinkali", 10),
    categorySeed("11111111-1111-1111-1111-111111111002", "Хачапури", "Hacapuri", "Khachapuri", 20),
    categorySeed("11111111-1111-1111-1111-111111111003", "Горячее", "Topla jela", "Hot dishes", 30),
    categorySeed("11111111-1111-1111-1111-111111111004", "Напитки", "Pica", "Drinks", 40),
  ];
  const items: AdminMenuItem[] = [
    itemSeed("22222222-2222-2222-2222-222222222001", categories[0].id, "Классические хинкали", "Замороженные хинкали с говядиной и зеленью. Минимум 5 шт", "690", "от 5 шт", 5, 10),
    itemSeed("22222222-2222-2222-2222-222222222002", categories[0].id, "Хинкали без кинзы", "Замороженные хинкали с говядиной без кинзы. Минимум 5 шт", "640", "от 5 шт", 5, 20),
    itemSeed("22222222-2222-2222-2222-222222222003", categories[1].id, "Аджарский хачапури", "Лодочка с сыром, яйцом и сливочным маслом", "890", "1 шт", 1, 30),
    itemSeed("22222222-2222-2222-2222-222222222004", categories[1].id, "Имеретинский хачапури", "Круглый хачапури с сыром внутри", "760", "1 шт", 1, 40),
    itemSeed("22222222-2222-2222-2222-222222222005", categories[2].id, "Чахохбили", "Курица в томатном соусе с травами", "940", "350 г", 1, 50),
    itemSeed("22222222-2222-2222-2222-222222222006", categories[2].id, "Лобио", "Фасоль с орехами, зеленью и специями", "620", "300 г", 1, 60),
    itemSeed("22222222-2222-2222-2222-222222222007", categories[3].id, "Лимонад тархун", "Холодный газированный лимонад", "290", "500 мл", 1, 70),
    itemSeed("22222222-2222-2222-2222-222222222008", categories[3].id, "Морс ягодный", "Домашний ягодный напиток", "260", "400 мл", 1, 80),
  ].map((item) => ({ ...item, created_at: now, updated_at: now }));
  refreshCategoryCounts({ categories, items });
  return { categories, items };
}

function categorySeed(id: string, ru: string, sr: string, en: string, sort: number): AdminCategory {
  const now = nowISO();
  return { id, title_ru: ru, title_sr: sr, title_en: en, sort_order: sort, visible: true, archived: false, item_count: 0, version: 1, created_at: now, updated_at: now };
}

function itemSeed(id: string, categoryID: string, title: string, description: string, price: string, weight: string, minQuantity: number, sort: number): AdminMenuItem {
  return {
    id,
    category_id: categoryID,
    title_ru: title,
    title_sr: title,
    title_en: title,
    description_ru: description,
    description_sr: "Opis",
    description_en: "Description",
    price_minor: Number(price),
    currency: "RSD",
    photo_path: "",
    weight_text: weight,
    min_quantity: minQuantity,
    allergen_text_ru: "",
    allergen_text_sr: "",
    allergen_text_en: "",
    sort_order: sort,
    visible: true,
    archived: false,
    used_in_orders: false,
    version: 1,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

function seedSettings(): Settings {
  return {
    timezone: "Europe/Belgrade",
    currency: "RSD",
    manual_day_off: false,
    day_off_banner: "ВЫХОДНОЙ",
    flat_delivery_fee_minor: 0,
    support_text: "@Tako_Lako",
    support_phone: "",
    terms_url: "",
    max_item_quantity: 10,
    max_comment_length: 300,
    cash_enabled: true,
    card_enabled: false,
    crypto_enabled: false,
    version: 1,
    schedule: defaultSchedule(),
  };
}

function defaultSchedule(): ScheduleDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day_of_week: day,
    closed: day === 1,
    open_time: "13:00",
    order_cutoff_time: "21:00",
    close_time: "22:00",
    version: 1,
  }));
}

function seedStaff(): StaffMember[] {
  const now = nowISO();
  return [
    { id: "33333333-3333-3333-3333-333333333001", telegram_user_id: 1048084234, display_label: "Owner ADMIN", role: "ADMIN", active: true, created_at: now, updated_at: now },
    { id: "33333333-3333-3333-3333-333333333002", telegram_user_id: 1048084234, display_label: "Owner KITCHEN", role: "KITCHEN", active: true, created_at: now, updated_at: now },
    { id: "33333333-3333-3333-3333-333333333003", telegram_user_id: 1048084234, display_label: "Owner COURIER", role: "COURIER", active: true, created_at: now, updated_at: now },
  ];
}

function runtimeFromSettings(settings: Settings) {
  const accepting = demoAcceptingState(settings);
  return {
    server_time: nowISO(),
    timezone: settings.timezone,
    accepting_orders: accepting.ok,
    reason: accepting.reason,
    next_opening: accepting.nextOpening,
    day_off_banner: settings.day_off_banner,
    flat_delivery_fee_minor: 0,
    currency: settings.currency,
    enabled_payments: settings.cash_enabled ? ["cash" as const] : [],
    supported_locales: ["ru" as const, "sr" as const, "en" as const],
    support_text: settings.support_text,
  };
}

function demoAcceptingState(settings: Settings): { ok: boolean; reason: string; nextOpening?: string } {
  const schedule = settings.schedule?.length === 7 ? settings.schedule : undefined;
  if (settings.manual_day_off) {
    return { ok: false, reason: "manual_day_off", nextOpening: demoNextOpening(schedule) };
  }
  const now = new Date();
  const today = schedule?.find((day) => day.day_of_week === now.getDay());
  if (!today || today.closed) {
    return { ok: false, reason: "weekly_day_off", nextOpening: demoNextOpening(schedule) };
  }
  const current = secondsSinceMidnight(now);
  const open = timeToSeconds(today.open_time);
  const cutoff = timeToSeconds(today.order_cutoff_time);
  if (current < open || current >= cutoff) {
    return { ok: false, reason: "schedule_closed", nextOpening: demoNextOpening(schedule) };
  }
  return { ok: true, reason: "open" };
}

function demoNextOpening(schedule?: Settings["schedule"]): string | undefined {
  if (!schedule?.length) return undefined;
  const now = new Date();
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    const day = schedule.find((entry) => entry.day_of_week === candidate.getDay());
    if (!day || day.closed) continue;
    const open = timeToSeconds(day.open_time);
    candidate.setHours(Math.floor(open / 3600), Math.floor((open % 3600) / 60), 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return undefined;
}

function secondsSinceMidnight(value: Date): number {
  return value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
}

function timeToSeconds(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 3600 + (Number.isFinite(minutes) ? minutes : 0) * 60;
}

function calculateAnalytics(range: AnalyticsRange): AdminAnalytics {
  const orders = filterOrdersByRange(loadOrders(), range);
  const delivered = orders.filter((order) => order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID");
  const revenue = delivered.reduce((sum, order) => sum + order.total_minor, 0);
  const statuses = groupOrders(orders, (order) => order.fulfillment_status);
  const payments = groupOrders(orders, (order) => order.payment_method);
  const top = new Map<string, { quantity: number; revenue_minor: number }>();
  delivered.forEach((order) => order.items.forEach((item) => {
    const current = top.get(item.snapshot_title) || { quantity: 0, revenue_minor: 0 };
    current.quantity += item.quantity;
    current.revenue_minor += item.line_total_minor;
    top.set(item.snapshot_title, current);
  }));
  const daily = groupDaily(orders);
  return {
    currency: "RSD",
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: nowISO(),
    generated_at: nowISO(),
    summary: {
      all_orders: orders.length,
      delivered_orders: delivered.length,
      cancelled_orders: orders.filter((order) => order.fulfillment_status === "CANCELLED").length,
      revenue_minor: revenue,
      average_check_minor: delivered.length ? Math.floor(revenue / delivered.length) : 0,
    },
    statuses,
    payments,
    top_dishes: [...top.entries()].map(([title, value]) => ({ title, quantity: value.quantity, revenue_minor: value.revenue_minor })).sort((a, b) => b.quantity - a.quantity),
    daily_rows: daily,
  };
}

function groupOrders(orders: Order[], pick: (order: Order) => string) {
  const map = new Map<string, { count: number; revenue_minor: number }>();
  orders.forEach((order) => {
    const key = pick(order);
    const current = map.get(key) || { count: 0, revenue_minor: 0 };
    current.count += 1;
    if (order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID") current.revenue_minor += order.total_minor;
    map.set(key, current);
  });
  return [...map.entries()].map(([key, value]) => ({ key, count: value.count, revenue_minor: value.revenue_minor }));
}

function groupDaily(orders: Order[]) {
  const map = new Map<string, { orders: number; delivered: number; cancelled: number; revenue_minor: number }>();
  orders.forEach((order) => {
    const day = order.created_at.slice(0, 10);
    const current = map.get(day) || { orders: 0, delivered: 0, cancelled: 0, revenue_minor: 0 };
    current.orders += 1;
    if (order.fulfillment_status === "DELIVERED") current.delivered += 1;
    if (order.fulfillment_status === "CANCELLED") current.cancelled += 1;
    if (order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID") current.revenue_minor += order.total_minor;
    map.set(day, current);
  });
  return [...map.entries()].map(([day, row]) => ({ day, ...row })).sort((a, b) => a.day.localeCompare(b.day));
}

function filterOrdersByRange(orders: Order[], range: AnalyticsRange): Order[] {
  const now = new Date();
  const start = new Date(now);
  if (range === "today") start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "month") start.setDate(1);
  if (range !== "today") start.setHours(0, 0, 0, 0);
  return orders.filter((order) => new Date(order.created_at).getTime() >= start.getTime());
}

function mutateOrder(id: string, reason: string, mutate: (order: Order) => Order): Order {
  const orders = loadOrders();
  const index = orders.findIndex((order) => order.id === id);
  const before = orders[index];
  if (!before || reason.trim() === "") throw apiError("INVALID_INPUT");
  const after = mutate(before);
  orders[index] = after;
  saveOrders(orders);
  pushAudit("order.change", "order", id, reason, { status: before.fulfillment_status }, { status: after.fulfillment_status });
  window.dispatchEvent(new StorageEvent("storage", { key: demoOrdersKey }));
  return after;
}

function categoryFromInput(input: CategoryInput, id: string): AdminCategory {
  return {
    id,
    title_ru: input.title_ru.trim(),
    title_sr: input.title_sr.trim(),
    title_en: input.title_en.trim(),
    sort_order: input.sort_order,
    visible: input.visible,
    archived: false,
    item_count: 0,
    version: 1,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

function itemFromInput(input: MenuItemInput, id: string): AdminMenuItem {
  return {
    ...input,
    min_quantity: Math.max(1, input.min_quantity || 1),
    id,
    currency: "RSD",
    archived: false,
    used_in_orders: false,
    version: 1,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

function staffFromInput(input: StaffInput & { telegram_user_id: number }, id: string): StaffMember {
  const now = nowISO();
  return { id, telegram_user_id: input.telegram_user_id, display_label: input.display_label, role: input.role, active: input.active, created_at: now, updated_at: now };
}

function refreshCategoryCounts(menu: AdminMenuResponse): void {
  menu.categories.forEach((category) => {
    category.item_count = menu.items.filter((item) => item.category_id === category.id && !item.archived).length;
  });
}

function mustFind<T extends { id: string }>(items: T[], id: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw apiError("INVALID_INPUT");
  return found;
}

function loadMenu(): AdminMenuResponse {
  return normalizeDemoMenu(loadJSON(demoMenuKey, seedMenu()));
}

function saveMenu(menu: AdminMenuResponse): void {
  refreshCategoryCounts(menu);
  saveJSON(demoMenuKey, menu);
  window.dispatchEvent(new StorageEvent("storage", { key: demoMenuKey }));
}

function normalizeDemoMenu(menu: AdminMenuResponse): AdminMenuResponse {
  return {
    ...menu,
    items: menu.items.map((item) => {
      if (item.id === "22222222-2222-2222-2222-222222222001") {
        return {
          ...item,
          description_ru: "Замороженные хинкали с говядиной и зеленью. Минимум 5 шт",
          weight_text: "от 5 шт",
          min_quantity: 5,
        };
      }
      if (item.id === "22222222-2222-2222-2222-222222222002") {
        return {
          ...item,
          title_ru: "Хинкали без кинзы",
          title_sr: "Hinkali bez korijandera",
          title_en: "Khinkali without cilantro",
          description_ru: "Замороженные хинкали с говядиной без кинзы. Минимум 5 шт",
          description_sr: "Zamrznuti hinkali sa govedinom bez korijandera. Minimum 5 kom",
          description_en: "Frozen beef khinkali without cilantro. Minimum 5 pcs",
          weight_text: "от 5 шт",
          min_quantity: 5,
        };
      }
      return { ...item, min_quantity: Math.max(1, item.min_quantity || 1) };
    }),
  };
}

function loadSettings(): Settings {
  const settings = loadJSON(demoSettingsKey, seedSettings());
  const normalized = {
    ...settings,
    flat_delivery_fee_minor: 0,
    support_text: "@Tako_Lako",
    max_item_quantity: Math.max(settings.max_item_quantity || 0, 99),
  };
  if (
    normalized.flat_delivery_fee_minor !== settings.flat_delivery_fee_minor ||
    normalized.support_text !== settings.support_text ||
    normalized.max_item_quantity !== settings.max_item_quantity
  ) {
    saveSettings(normalized);
  }
  return normalized;
}

function saveSettings(settings: Settings): void {
  saveJSON(demoSettingsKey, settings);
}

function loadOrders(): Order[] {
  return loadJSON<Order[]>(demoOrdersKey, []);
}

function saveOrders(orders: Order[]): void {
  saveJSON(demoOrdersKey, orders);
}

function loadStaff(): StaffMember[] {
  return loadJSON(demoStaffKey, seedStaff());
}

function saveStaff(staff: StaffMember[]): void {
  saveJSON(demoStaffKey, staff);
}

function loadAudit(): AuditEntry[] {
  return loadJSON(demoAuditKey, []);
}

function saveAudit(entries: AuditEntry[]): void {
  saveJSON(demoAuditKey, entries.slice(0, 100));
}

function pushAudit(action: string, targetType: string, targetID?: string, reason = "", before?: unknown, after?: unknown): void {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    actor_role: "ADMIN",
    action,
    target_type: targetType,
    target_id: targetID,
    reason,
    before: before as Record<string, unknown> | undefined,
    after: after as Record<string, unknown> | undefined,
    created_at: nowISO(),
  };
  saveAudit([entry, ...loadAudit()]);
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function clean(filter: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value)) as Record<string, string>;
}

function isToday(value: string): boolean {
  return value.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function nowISO(): string {
  return new Date().toISOString();
}

function apiError(code: string) {
  return Object.assign(new Error(code), { code });
}
