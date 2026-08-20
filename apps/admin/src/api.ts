import type {
  AdminAnalytics,
  AdminCategory,
  AdminDashboard,
  AdminMenuItem,
  AdminOrderCounts,
  AuditEntry,
  AuditLogResponse,
  Order,
  OrderSummary,
  Role,
  ScheduleDay,
  Settings,
  StaffMember,
} from "@tk-delivery/api-client/generated";

const demoOrdersKey = "tk-client-demo-orders-v1";
const demoMenuKey = "tk-admin-demo-menu-v6";
const demoSettingsKey = "tk-admin-demo-settings-v1";
const demoStaffKey = "tk-admin-demo-staff-v1";
const demoAuditKey = "tk-admin-demo-audit-v1";
const demoCryptoTestMigrationKey = "tk-demo-crypto-test-enabled-v1";
const getCache = new Map<string, { etag: string; payload: unknown }>();
const getCacheLimit = 64;

export type AdminTab = "home" | "menu" | "orders" | "schedule" | "analytics" | "settings" | "audit";
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

export interface AdminApiError extends Error {
  code: string;
  status?: number;
}

export interface AdminMenuResponse {
  categories: AdminCategory[];
  items: AdminMenuItem[];
}

export interface AdminOrdersResponse {
  orders: OrderSummary[];
  limit?: number;
  offset?: number;
  has_more?: boolean;
  counts?: AdminOrderCounts;
}

export interface AdminBootstrapOptions {
  range?: AnalyticsRange;
  status?: string;
  q?: string;
  date?: string;
  limit?: number;
  offset?: number;
}

export interface AdminBootstrapResponse {
  session: AdminSession;
  roles?: Role[];
  dashboard: AdminDashboard;
  menu?: AdminMenuResponse;
  settings?: Settings;
  schedule?: { schedule: ScheduleDay[] };
  orders?: AdminOrdersResponse;
  analytics?: AdminAnalytics;
  audit?: AuditLogResponse;
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
}

export interface StaffInput {
  telegram_user_id?: number;
  display_label: string;
  role: StaffRole;
  active: boolean;
}

export interface AdminApi {
  mode: "real" | "demo";
  bootstrap(tab: AdminTab, options?: AdminBootstrapOptions): Promise<AdminBootstrapResponse>;
  authenticate(): Promise<AdminSession>;
  dashboard(token: string, signal?: AbortSignal): Promise<AdminDashboard>;
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
  settings(token: string, signal?: AbortSignal): Promise<Settings>;
  updateSettings(token: string, input: SettingsInput): Promise<Settings>;
  setManualDayOff(token: string, enabled: boolean): Promise<Settings>;
  schedule(token: string): Promise<{ schedule: ScheduleDay[] }>;
  updateSchedule(token: string, schedule: ScheduleDay[]): Promise<{ schedule: ScheduleDay[] }>;
  orders(token: string, filter?: { status?: string; q?: string; date?: string; limit?: number; offset?: number }, signal?: AbortSignal): Promise<AdminOrdersResponse>;
  order(token: string, id: string): Promise<Order>;
  cancelOrder(token: string, id: string, reason: string): Promise<Order>;
  returnOrderToNew(token: string, id: string, reason: string): Promise<Order>;
  updateOrderContact(token: string, id: string, input: { phone: string; address: string; reason: string }): Promise<Order>;
  resendOrder(token: string, id: string, recipient: "client" | "courier", reason: string): Promise<{ ok: boolean }>;
  addOrderNote(token: string, id: string, reason: string): Promise<{ ok: boolean }>;
  staff(token: string): Promise<{ staff: StaffMember[] }>;
  addStaff(token: string, input: StaffInput & { telegram_user_id: number }): Promise<StaffMember>;
  updateStaff(token: string, id: string, input: StaffInput): Promise<StaffMember>;
  analytics(token: string, range: AnalyticsRange): Promise<AdminAnalytics>;
  analyticsCSV(token: string, range: AnalyticsRange): Promise<Blob>;
  audit(token: string, limit?: number, offset?: number): Promise<AuditLogResponse>;
  uploadMenuPhoto(token: string, file: File): Promise<MenuPhotoUploadResponse>;
}

export interface MenuPhotoUploadResponse {
  photo_path: string;
  photo_variants?: AdminMenuItem["photo_variants"];
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
    case "READY_FOR_PICKUP":
      return "Готов к выдаче";
    case "DELIVERED":
      return "Доставлен";
    case "CANCELLED":
      return "Отменён";
  }
}

export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  return status === 401 || status === 403 || code === "AUTH_INVALID" || code === "FORBIDDEN";
}

function realApi(baseURL: string, appEnv: string): AdminApi {
  const authenticate = async () => {
    const initData = rawInitData();
    if (appEnv === "production" && !initData) throw apiError("TELEGRAM_INIT_DATA_MISSING");
    const response =
      appEnv === "production"
        ? await post(`${baseURL}/api/v1/auth/telegram`, {
            audience: "staff",
            role: "ADMIN",
            init_data: initData,
          })
        : await post(`${baseURL}/api/v1/dev/session`, { telegram_user_id: 1048084234, role: "ADMIN" });
    return response.session;
  };

  const sectionFromToken = async (session: AdminSession, tab: AdminTab, options: AdminBootstrapOptions = {}): Promise<AdminBootstrapResponse> => {
    const token = session.token;
    const adminOrders = (filter: AdminBootstrapOptions, signal?: AbortSignal) => fetchAdminOrders(baseURL, token, filter, signal);
    const response: AdminBootstrapResponse = {
      session,
      dashboard: await get(`${baseURL}/api/v1/admin/dashboard`, token),
    };
    switch (tab) {
      case "home":
        response.settings = await get(`${baseURL}/api/v1/admin/settings`, token);
        break;
      case "menu":
        response.menu = await get(`${baseURL}/api/v1/admin/menu`, token);
        break;
      case "orders":
        response.orders = await adminOrders(options);
        break;
      case "schedule":
        response.schedule = await get(`${baseURL}/api/v1/admin/schedule`, token);
        break;
      case "settings":
        response.settings = await get(`${baseURL}/api/v1/admin/settings`, token);
        break;
      case "analytics":
        response.analytics = await get(`${baseURL}/api/v1/admin/analytics?range=${options.range || "today"}`, token);
        break;
      case "audit":
        response.audit = await get(`${baseURL}/api/v1/admin/audit?limit=${options.limit || 50}&offset=${options.offset || 0}`, token);
        break;
    }
    return response;
  };

  return {
    mode: "real",
    async bootstrap(tab, options = {}) {
      const initData = rawInitData();
      if (appEnv === "production" && !initData) throw apiError("TELEGRAM_INIT_DATA_MISSING");
      try {
        return await post(`${baseURL}/api/v1/bootstrap/admin`, {
          init_data: initData,
          tab,
          range: options.range,
          status: options.status,
          q: options.q,
          date: options.date,
          limit: options.limit || (tab === "audit" ? 50 : 20),
          offset: options.offset || 0,
        });
      } catch (err) {
        if (!isMissingEndpoint(err)) throw err;
      }
      return sectionFromToken(await authenticate(), tab, options);
    },
    authenticate,
    dashboard: (token, signal) => get(`${baseURL}/api/v1/admin/dashboard`, token, signal),
    menu: (token) => get(`${baseURL}/api/v1/admin/menu`, token),
    createCategory: (token, input) => post(`${baseURL}/api/v1/admin/categories`, input, token),
    updateCategory: (token, id, input) => put(`${baseURL}/api/v1/admin/categories/${id}`, input, token),
    archiveCategory: (token, id, reason) => post(`${baseURL}/api/v1/admin/categories/${id}/archive`, { reason }, token),
    restoreCategory: (token, id, reason) => post(`${baseURL}/api/v1/admin/categories/${id}/restore`, { reason }, token),
    deleteCategory: (token, id, reason) => del(`${baseURL}/api/v1/admin/categories/${id}`, token, { reason }),
    createItem: (token, input) => post(`${baseURL}/api/v1/admin/items`, input, token),
    updateItem: (token, id, input) => put(`${baseURL}/api/v1/admin/items/${id}`, input, token),
    archiveItem: (token, id, reason) => post(`${baseURL}/api/v1/admin/items/${id}/archive`, { reason }, token),
    restoreItem: (token, id, reason) => post(`${baseURL}/api/v1/admin/items/${id}/restore`, { reason }, token),
    deleteItem: (token, id, reason) => del(`${baseURL}/api/v1/admin/items/${id}`, token, { reason }),
    settings: (token, signal) => get(`${baseURL}/api/v1/admin/settings`, token, signal),
    updateSettings: (token, input) => put(`${baseURL}/api/v1/admin/settings`, input, token),
    setManualDayOff: (token, enabled) => put(`${baseURL}/api/v1/admin/settings/manual-day-off`, { enabled }, token),
    schedule: (token) => get(`${baseURL}/api/v1/admin/schedule`, token),
    updateSchedule: (token, schedule) => put(`${baseURL}/api/v1/admin/schedule`, { schedule }, token),
    orders: (token, filter = {}, signal) => fetchAdminOrders(baseURL, token, filter, signal),
    order: (token, id) => get(`${baseURL}/api/v1/admin/orders/${id}`, token),
    cancelOrder: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/cancel`, { reason }, token),
    returnOrderToNew: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/return-to-new`, { reason }, token),
    updateOrderContact: (token, id, input) => put(`${baseURL}/api/v1/admin/orders/${id}/contact`, input, token),
    resendOrder: (token, id, recipient, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/resend`, { recipient, reason }, token),
    addOrderNote: (token, id, reason) => post(`${baseURL}/api/v1/admin/orders/${id}/note`, { reason }, token),
    staff: (token) => get(`${baseURL}/api/v1/admin/staff`, token),
    addStaff: (token, input) => post(`${baseURL}/api/v1/admin/staff`, input, token),
    updateStaff: (token, id, input) => put(`${baseURL}/api/v1/admin/staff/${id}`, input, token),
    analytics: (token, range) => get(`${baseURL}/api/v1/admin/analytics?range=${range}`, token),
    analyticsCSV: (token, range) => getBlob(`${baseURL}/api/v1/admin/analytics.csv?range=${range}`, token),
    audit: (token, limit = 50, offset = 0) => get(`${baseURL}/api/v1/admin/audit?limit=${limit}&offset=${offset}`, token),
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
  const authenticate = async () => ({
    token: "demo-admin-token",
    telegram_user_id: 1048084234,
    active_role: "ADMIN",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } satisfies AdminSession);
  const dashboard = async (): Promise<AdminDashboard> => {
    const settings = loadSettings();
    const orders = loadOrders();
    return {
      runtime: runtimeFromSettings(settings),
      new_orders: orders.filter((order) => order.fulfillment_status === "NEW").length,
      out_for_delivery: orders.filter((order) => order.fulfillment_type !== "pickup" && order.fulfillment_status === "OUT_FOR_DELIVERY").length,
      ready_for_pickup: orders.filter((order) => order.fulfillment_type === "pickup" && order.fulfillment_status === "READY_FOR_PICKUP").length,
      orders_today: orders.filter((order) => isToday(order.created_at)).length,
      revenue_today_minor: orders
        .filter((order) => isToday(order.created_at) && order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID")
        .reduce((sum, order) => sum + order.total_minor, 0),
      notification_errors: [],
      generated_at: new Date().toISOString(),
    };
  };
  return {
    mode: "demo",
    async bootstrap(tab, options = {}) {
      const response: AdminBootstrapResponse = {
        session: await authenticate(),
        dashboard: await dashboard(),
      };
      if (tab === "home" || tab === "settings") {
        response.settings = loadSettings();
      } else if (tab === "menu") {
        response.menu = loadMenu();
      } else if (tab === "orders") {
        const allOrders = loadOrders();
        const countBase = filterDemoOrders(allOrders, { q: options.q, date: options.date });
        const orders = filterDemoOrders(allOrders, options);
        const offset = options.offset || 0;
        const limit = options.limit || 20;
        response.orders = { orders: orders.slice(offset, offset + limit), limit, offset, has_more: orders.length > offset + limit, counts: demoOrderCounts(countBase) };
      } else if (tab === "schedule") {
        response.schedule = { schedule: loadSettings().schedule || defaultSchedule() };
      } else if (tab === "analytics") {
        response.analytics = calculateAnalytics(options.range || "today");
      } else if (tab === "audit") {
        response.audit = demoAuditPage(options.limit, options.offset);
      }
      return response;
    },
    authenticate,
    dashboard,
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
      if (input.card_enabled || !input.cash_enabled) throw apiError("INVALID_INPUT");
      const before = loadSettings();
      if (before.version !== input.version) throw apiError("ORDER_STATUS_CONFLICT");
      const after: Settings = { ...before, ...input, card_enabled: false, version: before.version + 1 };
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
      const allOrders = loadOrders();
      const countBase = filterDemoOrders(allOrders, { q: filter.q, date: filter.date });
      const orders = filterDemoOrders(allOrders, filter);
      const offset = filter.offset || 0;
      const limit = filter.limit || 20;
      return { orders: orders.slice(offset, offset + limit), limit, offset, has_more: orders.length > offset + limit, counts: demoOrderCounts(countBase) };
    },
    async order(_token, id) {
      const order = loadOrders().find((entry) => entry.id === id);
      if (!order) throw apiError("INVALID_INPUT", 404);
      return {
        ...order,
        events: [
          {
            id: `${id}-event-created`,
            order_id: id,
            from_status: "",
            to_status: order.fulfillment_status,
            action: "order.demo_snapshot",
            actor_role: "ADMIN",
            reason: "demo",
            created_at: order.created_at,
          },
        ],
      };
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
    async analyticsCSV(_token, range) {
      const analytics = calculateAnalytics(range);
      const rows = [
        "day,orders,delivered,cancelled,revenue_minor",
        ...analytics.daily_rows.map((row) => `${row.day},${row.orders},${row.delivered},${row.cancelled},${row.revenue_minor}`),
        "",
        "payment_method,orders,delivered,paid,cancelled,revenue_minor",
        ...analytics.payments.map((row) => `${row.key},${row.count},${row.delivered_count},${row.paid_count},${row.cancelled_count},${row.revenue_minor}`),
      ];
      return new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    },
    async audit(_token, limit = 50, offset = 0) {
      return demoAuditPage(limit, offset);
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
    bootstrap: fail as (tab: AdminTab, options?: AdminBootstrapOptions) => Promise<AdminBootstrapResponse>,
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
    order: fail,
    cancelOrder: fail,
    returnOrderToNew: fail,
    updateOrderContact: fail,
    resendOrder: fail,
    addOrderNote: fail,
    staff: fail,
    addStaff: fail,
    updateStaff: fail,
    analytics: fail,
    analyticsCSV: fail,
    audit: fail,
    uploadMenuPhoto: fail,
  };
}

async function get(url: string, token?: string, signal?: AbortSignal) {
  const cacheKey = `${token || "public"}\n${url}`;
  const cached = getCache.get(cacheKey);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  const response = await fetch(url, { headers, signal });
  return read(response, cacheKey);
}

async function getBlob(url: string, token?: string) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw apiError(payload?.error?.code || "SERVER_UNAVAILABLE", response.status);
  }
  return response.blob();
}

async function fetchAdminOrders(baseURL: string, token: string, filter: { status?: string; q?: string; date?: string; limit?: number; offset?: number }, signal?: AbortSignal): Promise<AdminOrdersResponse> {
  const request = adminOrdersRequest(filter);
  try {
    return await post(`${baseURL}/api/v1/admin/orders/search`, cleanBody(request), token, signal);
  } catch (err) {
    if (!isMissingEndpoint(err)) throw err;
  }
  return get(`${baseURL}/api/v1/admin/orders?${new URLSearchParams(clean(request))}`, token, signal);
}

async function post(url: string, body: unknown, token?: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
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

async function del(url: string, token?: string, body?: unknown) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return read(response);
}

async function read(response: Response, cacheKey?: string) {
  if (response.status === 304 && cacheKey) {
    const cached = getCache.get(cacheKey);
    if (cached) return cached.payload;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload?.error?.code || "SERVER_UNAVAILABLE", response.status);
  const etag = response.headers.get("ETag");
  if (cacheKey && etag) {
    rememberGetCache(cacheKey, etag, payload);
  }
  return payload;
}

function rememberGetCache(cacheKey: string, etag: string, payload: unknown): void {
  if (getCache.has(cacheKey)) getCache.delete(cacheKey);
  getCache.set(cacheKey, { etag, payload });
  while (getCache.size > getCacheLimit) {
    const oldestKey = getCache.keys().next().value;
    if (!oldestKey) return;
    getCache.delete(oldestKey);
  }
}

function isMissingEndpoint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 404;
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
  const media = (slug: string) => `/media/menu/${slug}.jpg`;
  const categories: AdminCategory[] = [
    categorySeed("33333333-3333-3333-3333-333333333001", "Хачапури и горячие блюда", "Hacapuri i topla jela", "Khachapuri and hot dishes", 10),
    categorySeed("33333333-3333-3333-3333-333333333002", "Соусы", "Sosevi", "Sauces", 20),
    categorySeed("33333333-3333-3333-3333-333333333003", "Супы", "Supe", "Soups", 30),
    categorySeed("33333333-3333-3333-3333-333333333004", "Салаты и закуски", "Salate i predjela", "Salads and appetizers", 40),
    categorySeed("33333333-3333-3333-3333-333333333005", "Десерты", "Deserti", "Desserts", 50),
    categorySeed("33333333-3333-3333-3333-333333333006", "Напитки", "Pica", "Drinks", 60),
  ];
  const items: AdminMenuItem[] = [
    itemSeed(
      "44444444-4444-4444-4444-444444444001",
      categories[0].id,
      "Аджарский хачапури",
      "Adzarski hacapuri",
      "Adjarian khachapuri",
      "Лодочка с сыром и яйцом.",
      "Oblik camca sa jajetom.",
      "Boat-shaped cheese bread with egg.",
      "1120",
      "",
      1,
      10,
      media("adzarski-hacapuri"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444002",
      categories[0].id,
      "Мегрельский хачапури",
      "Megrelski hacapuri",
      "Megrelian khachapuri",
      "Круглый хачапури с сыром внутри и сверху.",
      "Okrugli, sir unutra i odozgo.",
      "Round cheese bread with cheese inside and on top.",
      "1190",
      "",
      1,
      20,
      media("megrelski-hacapuri"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444003",
      categories[0].id,
      "Оджахури с мясом",
      "Adzahuri sa mesom",
      "Ojakhuri with meat",
      "Говядина, картофель, красная паприка, зелень.",
      "Govedina, krompir, crvena paprika, zelenilo.",
      "Beef, potatoes, red pepper and herbs.",
      "1330",
      "",
      1,
      30,
      media("adzahuri-sa-mesom"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444004",
      categories[0].id,
      "Чкмерули",
      "Ckmeruli",
      "Chkmeruli",
      "Куриное мясо без кости в сливочно-чесночном соусе.",
      "Pilece meso bez kosti u kremasto-belom sosu sa belim lukom.",
      "Boneless chicken in creamy garlic sauce.",
      "1120",
      "",
      1,
      40,
      media("ckmeruli"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444005",
      categories[1].id,
      "Сацебели",
      "Sacebeli",
      "Satsebeli",
      "Томатная основа, специи, зелень.",
      "Paradajz osnova, zacini, zelenilo.",
      "Tomato base, spices and herbs.",
      "210",
      "",
      1,
      10,
      media("sacebeli"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444006",
      categories[1].id,
      "Сливочно-чесночный соус",
      "Kremasti sos sa belim lukom",
      "Creamy garlic sauce",
      "Сливочный соус с чесноком.",
      "Kremasti sos sa belim lukom.",
      "Creamy sauce with garlic.",
      "140",
      "",
      1,
      20,
      media("kremasti-sos-sa-belim-lukom"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444007",
      categories[2].id,
      "Лобио без мяса",
      "Lobio bez mesa",
      "Meatless lobio",
      "Фасолевый суп без мяса.",
      "Lobio bez mesa.",
      "Meatless bean soup.",
      "350",
      "",
      1,
      10,
      media("lobio-bez-mesa"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444008",
      categories[3].id,
      "Салат «Тбилиси»",
      "Salata „tbilisi”",
      "Tbilisi salad",
      "Говядина, фасоль, красная паприка, лук, грецкий орех, чеснок, зелень.",
      "Govedina, pasulj, crvena paprika, luk, orah, beli luk, zelenilo.",
      "Beef, beans, red pepper, onion, walnut, garlic and herbs.",
      "1050",
      "",
      1,
      10,
      media("salata-tbilisi"),
      "грецкий орех",
      "orah",
      "walnut",
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444009",
      categories[3].id,
      "Грузинский салат",
      "Gruzijska salata",
      "Georgian salad",
      "Помидор, огурец, лук, грецкий орех, масло.",
      "Paradajz, krastavac, luk, orah, ulje.",
      "Tomato, cucumber, onion, walnut and oil.",
      "630",
      "",
      1,
      20,
      media("gruzijska-salata"),
      "грецкий орех",
      "orah",
      "walnut",
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444010",
      categories[3].id,
      "Рулетики из баклажана",
      "Rolnice od patlidzana",
      "Eggplant rolls",
      "Ореховая начинка, зелень.",
      "Orahov nadev, zelenilo.",
      "Walnut filling and herbs.",
      "770",
      "",
      1,
      30,
      media("rolnice-od-patlidzana"),
      "грецкий орех",
      "orah",
      "walnut",
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444011",
      categories[4].id,
      "Медовик",
      "Medovik",
      "Honey cake",
      "Медовые коржи и нежный крем.",
      "Medene kore i nezan krem.",
      "Honey layers and delicate cream.",
      "630",
      "",
      1,
      10,
      media("medovik"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444012",
      categories[4].id,
      "Пирожное «Картошка»",
      "Kolac „krompir”",
      "Potato cake",
      "Шоколадный десерт из бисквитной крошки и какао.",
      "Cokoladni desert od biskvitnih mrvica i kakaa.",
      "Chocolate dessert made with biscuit crumbs and cocoa.",
      "532",
      "",
      1,
      20,
      media("kolac-krompir"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444013",
      categories[5].id,
      "Натакхари с грушей 0.5 л",
      "Natakhtari sa kruskom 0.5 l",
      "Natakhtari pear 0.5 l",
      "Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.",
      "Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.",
      "Chef's recommendation: Georgian sparkling lemonade with pear flavor.",
      "588",
      "0.5 л",
      1,
      10,
      media("natakhtari-pear-05l"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444014",
      categories[5].id,
      "Вода Rosa негазированная",
      "Voda Rosa negazirana",
      "Rosa still water",
      "",
      "",
      "",
      "140",
      "",
      1,
      20,
      media("rosa-still-water"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444015",
      categories[5].id,
      "Вода Knjaz Milos газированная",
      "Voda Knjaz Milos gazirana",
      "Knjaz Milos sparkling water",
      "",
      "",
      "",
      "280",
      "",
      1,
      30,
      media("knjaz-milos-sparkling-water"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444016",
      categories[5].id,
      "Натакхари виноград 0.5 л",
      "Natakhtari grozdje 0.5 l",
      "Natakhtari grape 0.5 l",
      "Грузинский газированный лимонад со вкусом винограда.",
      "Gruzijsko gazirano pice sa ukusom grozdja.",
      "Georgian sparkling lemonade with grape flavor.",
      "588",
      "0.5 л",
      1,
      40,
      media("natakhtari-grape-05l"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444017",
      categories[5].id,
      "Комбуча",
      "Kombuca",
      "Kombucha",
      "Холодный ферментированный чай.",
      "Hladni fermentisani caj.",
      "Cold fermented tea.",
      "868",
      "",
      1,
      50,
      media("kombucha"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444018",
      categories[5].id,
      "Coca-Cola 0.33 л",
      "Coca-Cola 0.33 l",
      "Coca-Cola 0.33 l",
      "",
      "",
      "",
      "280",
      "0.33 л",
      1,
      60,
      media("coca-cola-033l"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444019",
      categories[5].id,
      "Coca-Cola 0.5 л",
      "Coca-Cola 0.5 l",
      "Coca-Cola 0.5 l",
      "",
      "",
      "",
      "350",
      "0.5 л",
      1,
      70,
      media("coca-cola-05l"),
    ),
    itemSeed(
      "44444444-4444-4444-4444-444444444020",
      categories[5].id,
      "Coca-Cola 1 л",
      "Sok Gazirani Coca Cola 1 l",
      "Coca-Cola 1 l",
      "",
      "",
      "",
      "460",
      "1 л",
      1,
      80,
      media("coca-cola-1l"),
    ),
  ].map((item) => ({ ...item, created_at: now, updated_at: now }));
  refreshCategoryCounts({ categories, items });
  return {
    categories: [...categories].sort((a, b) => a.sort_order - b.sort_order || a.title_ru.localeCompare(b.title_ru, "ru")),
    items: [...items].sort((a, b) => a.sort_order - b.sort_order || a.title_ru.localeCompare(b.title_ru, "ru")),
  };
}

function categorySeed(id: string, ru: string, sr: string, en: string, sort: number): AdminCategory {
  const now = nowISO();
  return { id, title_ru: ru, title_sr: sr, title_en: en, sort_order: sort, visible: true, archived: false, item_count: 0, version: 1, created_at: now, updated_at: now };
}

function itemSeed(
  id: string,
  categoryID: string,
  titleRu: string,
  titleSr: string,
  titleEn: string,
  descriptionRu: string,
  descriptionSr: string,
  descriptionEn: string,
  price: string,
  weight: string,
  minQuantity: number,
  sort: number,
  photoPath = "",
  allergenTextRu = "",
  allergenTextSr = "",
  allergenTextEn = "",
): AdminMenuItem {
  return {
    id,
    category_id: categoryID,
    title_ru: titleRu,
    title_sr: titleSr,
    title_en: titleEn,
    description_ru: descriptionRu,
    description_sr: descriptionSr,
    description_en: descriptionEn,
    price_minor: Number(price),
    currency: "RSD",
    photo_path: photoPath,
    weight_text: weight,
    min_quantity: minQuantity,
    allergen_text_ru: allergenTextRu,
    allergen_text_sr: allergenTextSr,
    allergen_text_en: allergenTextEn,
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
    crypto_enabled: true,
    cash_location_required: true,
    restaurant_latitude: 45.24197,
    restaurant_longitude: 19.808807,
    cash_location_radius_meters: 12000,
    cash_location_ttl_seconds: 180,
    cash_location_max_accuracy_meters: 200,
    pickup_enabled: true,
    pickup_address: "Tako Lako, Novi Sad",
    pickup_map_url: "https://maps.google.com/?q=45.241970,19.808807",
    pickup_instructions_ru: "Приходите к выбранному времени и назовите номер заказа.",
    pickup_instructions_sr: "Dođite u izabrano vreme i recite broj porudžbine.",
    pickup_instructions_en: "Come at the selected time and tell us your order number.",
    pickup_min_lead_minutes: 40,
    pickup_slot_minutes: 15,
    pickup_max_orders_per_slot: 3,
    pickup_last_time: "22:00",
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
    enabled_payments: [
      ...(settings.cash_enabled ? ["cash" as const] : []),
      ...(settings.crypto_enabled ? ["crypto" as const] : []),
    ],
    supported_locales: ["ru" as const, "sr" as const, "en" as const],
    support_text: settings.support_text,
    terms_url: settings.terms_url,
    cash_location_required: settings.cash_location_required,
    cash_location_radius_meters: settings.cash_location_radius_meters,
    pickup_enabled: settings.pickup_enabled,
    pickup_address: settings.pickup_address,
    pickup_map_url: settings.pickup_map_url,
    pickup_min_lead_minutes: settings.pickup_min_lead_minutes,
    pickup_slot_minutes: settings.pickup_slot_minutes,
    pickup_last_time: settings.pickup_last_time,
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
    top_dishes: [...top.entries()].map(([title, value]) => ({ title, quantity: value.quantity, revenue_minor: value.revenue_minor })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    daily_rows: daily,
  };
}

function groupOrders(orders: Order[], pick: (order: Order) => string) {
  const map = new Map<string, { count: number; delivered_count: number; paid_count: number; cancelled_count: number; revenue_minor: number }>();
  orders.forEach((order) => {
    const key = pick(order);
    const current = map.get(key) || { count: 0, delivered_count: 0, paid_count: 0, cancelled_count: 0, revenue_minor: 0 };
    current.count += 1;
    if (order.fulfillment_status === "DELIVERED") current.delivered_count += 1;
    if (order.payment_status === "PAID") current.paid_count += 1;
    if (order.fulfillment_status === "CANCELLED") current.cancelled_count += 1;
    if (order.fulfillment_status === "DELIVERED" && order.payment_status === "PAID") current.revenue_minor += order.total_minor;
    map.set(key, current);
  });
  return [...map.entries()].map(([key, value]) => ({ key, ...value }));
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
    categories: [...menu.categories].sort((a, b) => a.sort_order - b.sort_order || a.title_ru.localeCompare(b.title_ru, "ru")),
    items: menu.items
      .map((item) => ({ ...item, min_quantity: Math.max(1, item.min_quantity || 1) }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.sort_order - b.sort_order || a.title_ru.localeCompare(b.title_ru, "ru")),
  };
}

function loadSettings(): Settings {
  const settings = loadJSON(demoSettingsKey, seedSettings());
  const shouldEnableCryptoTest = !localStorage.getItem(demoCryptoTestMigrationKey);
  const normalized = {
    ...settings,
    flat_delivery_fee_minor: 0,
    support_text: "@Tako_Lako",
    max_item_quantity: Math.max(settings.max_item_quantity || 0, 99),
    crypto_enabled: shouldEnableCryptoTest ? true : settings.crypto_enabled,
    cash_location_required: settings.cash_location_required ?? true,
    restaurant_latitude: settings.restaurant_latitude ?? 45.24197,
    restaurant_longitude: settings.restaurant_longitude ?? 19.808807,
    cash_location_radius_meters: settings.cash_location_radius_meters || 12000,
    cash_location_ttl_seconds: settings.cash_location_ttl_seconds || 180,
    cash_location_max_accuracy_meters: settings.cash_location_max_accuracy_meters || 200,
    pickup_enabled: settings.pickup_enabled ?? true,
    pickup_address: settings.pickup_address || "Tako Lako, Novi Sad",
    pickup_map_url: settings.pickup_map_url || "https://maps.google.com/?q=45.241970,19.808807",
    pickup_instructions_ru: settings.pickup_instructions_ru || "Приходите к выбранному времени и назовите номер заказа.",
    pickup_instructions_sr: settings.pickup_instructions_sr || "Dođite u izabrano vreme i recite broj porudžbine.",
    pickup_instructions_en: settings.pickup_instructions_en || "Come at the selected time and tell us your order number.",
    pickup_min_lead_minutes: settings.pickup_min_lead_minutes || 40,
    pickup_slot_minutes: settings.pickup_slot_minutes || 15,
    pickup_max_orders_per_slot: settings.pickup_max_orders_per_slot || 3,
    pickup_last_time: settings.pickup_last_time || "22:00",
  };
  if (
    normalized.flat_delivery_fee_minor !== settings.flat_delivery_fee_minor ||
    normalized.support_text !== settings.support_text ||
    normalized.max_item_quantity !== settings.max_item_quantity ||
    normalized.crypto_enabled !== settings.crypto_enabled
  ) {
    saveSettings(normalized);
  }
  if (shouldEnableCryptoTest) localStorage.setItem(demoCryptoTestMigrationKey, "1");
  return normalized;
}

function saveSettings(settings: Settings): void {
  saveJSON(demoSettingsKey, settings);
}

function loadOrders(): Order[] {
  return loadJSON<Order[]>(demoOrdersKey, []);
}

function filterDemoOrders(orders: Order[], filter: { status?: string; q?: string; date?: string }): Order[] {
  let next = orders;
  const status = (filter.status || "").trim().toUpperCase();
  if (status === "ACTIVE") {
    next = next.filter((order) => order.fulfillment_status === "NEW" || order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP");
  } else if (status === "HISTORY") {
    next = next.filter((order) => order.fulfillment_status === "DELIVERED" || order.fulfillment_status === "CANCELLED");
  } else if (status === "READY") {
    next = next.filter((order) => order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP");
  } else if (status) {
    next = next.filter((order) => order.fulfillment_status === status);
  }
  const q = (filter.q || "").trim().toLowerCase();
  if (q) {
    next = next.filter((order) =>
      String(order.public_number).includes(q) ||
      (order.phone || "").toLowerCase().includes(q) ||
      (order.client_username || "").toLowerCase().includes(q) ||
      (order.client_first_name || "").toLowerCase().includes(q),
    );
  }
  if (filter.date) next = next.filter((order) => order.created_at.slice(0, 10) === filter.date);
  return next;
}

function demoOrderCounts(orders: OrderSummary[]): AdminOrderCounts {
  return {
    active: orders.filter((order) => order.fulfillment_status === "NEW" || order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP").length,
    new: orders.filter((order) => order.fulfillment_status === "NEW").length,
    ready: orders.filter((order) => order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP").length,
    history: orders.filter((order) => order.fulfillment_status === "DELIVERED" || order.fulfillment_status === "CANCELLED").length,
  };
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

function demoAuditPage(limit = 50, offset = 0): AuditLogResponse {
  const entries = loadAudit();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const safeOffset = Math.max(Math.trunc(offset) || 0, 0);
  return {
    entries: entries.slice(safeOffset, safeOffset + safeLimit),
    limit: safeLimit,
    offset: safeOffset,
    has_more: entries.length > safeOffset + safeLimit,
  };
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

function cleanBody(filter: Record<string, string | number | undefined>): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "") body[key] = value;
  }
  return body;
}

function clean(filter: Record<string, string | number | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
}

function adminOrdersRequest(filter: { status?: string; q?: string; date?: string; limit?: number; offset?: number }): Record<string, string | number | undefined> {
  return {
    status: filter.status,
    q: filter.q,
    date: filter.date,
    limit: filter.limit || 20,
    offset: filter.offset || 0,
  };
}

function isToday(value: string): boolean {
  return value.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function nowISO(): string {
  return new Date().toISOString();
}

function apiError(code: string, status?: number) {
  return Object.assign(new Error(code), { code, status } satisfies Pick<AdminApiError, "code" | "status">);
}
