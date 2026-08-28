import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("client startup uses bootstrap without private history or contact waterfall", () => {
  const apiSource = readSource("apps/client/src/api.ts");
  const appSource = readSource("apps/client/src/App.tsx");
  const bootstrapBody = sliceBetween(apiSource, "async bootstrap(locale)", "    authenticate,");

  assertIncludes(bootstrapBody, "/api/v1/bootstrap/client");
  assertNotIncludes(bootstrapBody, "/api/v1/orders");
  assertNotIncludes(bootstrapBody, "/api/v1/contact");
  assertIncludes(appSource, "const response = await api.bootstrap(locale)");
  assertIncludes(appSource, "if (!token || route.name !== \"checkout\" || verifiedContact?.verified) return;");
  assertIncludes(appSource, "if (!token || route.name !== \"orders\") return;");
});

test("client DEV sandbox never falls back to the production bot card", () => {
  const appSource = readSource("apps/client/src/App.tsx");

  assertIncludes(appSource, "const [loading, setLoading] = useState(!data.runtime)");
  assertIncludes(appSource, "setLoading(true)");
  assertIncludes(appSource, "devSandbox ? <DevSandboxUnavailable locale={locale} /> : <PublicBotLanding locale={locale} />");
  assertIncludes(appSource, "route.name === \"menu\" && !data.session && !devSandbox");
});

test("only the primary DEV owner can bypass the active-order checkout lock", () => {
  const appSource = readSource("apps/client/src/App.tsx");

  assertIncludes(appSource, "const allowConcurrentDevOrders = devSandbox && data.session?.telegram_user_id === 1048084234");
  assertIncludes(appSource, "if (activeOrder && !allowConcurrentDevOrders)");
  assertIncludes(appSource, "activeOrder={allowConcurrentDevOrders ? undefined : activeOrder}");
  assertIncludes(appSource, "activeOrder && !allowConcurrentDevOrders ? <ActiveOrderLock");
});

test("kitchen and courier startup use one role bootstrap request", () => {
  const kitchenSource = readSource("apps/kitchen/src/App.tsx");
  const courierSource = readSource("apps/courier/src/App.tsx");

  assertIncludes(kitchenSource, "api.bootstrap(\"KITCHEN\").then((response) => {");
  assertIncludes(kitchenSource, "applySession(response.session)");
  assertIncludes(kitchenSource, "setOrders(response.orders)");
  assertIncludes(courierSource, "api.bootstrap(\"COURIER\").then((response) => {");
  assertIncludes(courierSource, "applySession(response.session)");
  assertIncludes(courierSource, "setOrders(response.orders)");
});

test("admin startup and fallback load dashboard plus only the visible section", () => {
  const appSource = readSource("apps/admin/src/App.tsx");
  const apiSource = readSource("apps/admin/src/api.ts");
  const loadSectionsBody = sliceBetween(appSource, "async function loadAdminSections", "  async function refreshHomeSection");
  const fallbackBody = sliceBetween(apiSource, "const sectionFromToken", "  return {");

  assertIncludes(appSource, "api.bootstrap(tab, bootstrapOptions(tab, range))");
  assertIncludes(appSource, "function bootstrapOptions(tab: AdminTab, range: AnalyticsRange)");
  assertIncludes(appSource, "limit: tab === \"audit\" ? 50 : 20");
  assert.match(
    loadSectionsBody,
    /const sections:[^\n]+=\s*\[\["dashboard", api\.dashboard\(authToken\)\]\];/,
    "loadAdminSections must start with dashboard only, not all admin sections",
  );
  assertIncludes(loadSectionsBody, "if (targetTab === \"home\")");
  assertIncludes(loadSectionsBody, "else if (targetTab === \"menu\")");
  assertIncludes(loadSectionsBody, "else if (targetTab === \"orders\")");
  assertIncludes(fallbackBody, "dashboard: await get(`${baseURL}/api/v1/admin/dashboard`, token)");
  assertIncludes(fallbackBody, "switch (tab)");
  assertIncludes(fallbackBody, "case \"menu\":");
  assertIncludes(fallbackBody, "case \"orders\":");
});

test("admin audit log stays paginated and bounded across backend, frontend, fallback and demo", () => {
  const serverSource = readSource("backend/internal/httpapi/server.go");
  const storeSource = readSource("backend/internal/store/store.go");
  const adminAppSource = readSource("apps/admin/src/App.tsx");
  const lazyAdminSource = readSource("apps/admin/src/LazyAdminSections.tsx");
  const adminApiSource = readSource("apps/admin/src/api.ts");
  const openAPISource = readSource("docs/openapi.yaml");
  const adminAuditHandler = sliceBetween(serverSource, "func (s *Server) adminAudit", "func (s *Server) adminUploadMenuPhoto");
  const auditLogStore = sliceBetween(storeSource, "func (s *Store) AuditLog", "func (s *Store) MarkReady");
  const auditTab = sliceBetween(lazyAdminSource, "export function AuditSection", "function Metric");
  const auditPageMeta = sliceBetween(adminAppSource, "function auditPageMeta", "function bootstrapOptions");
  const fallbackBody = sliceBetween(adminApiSource, "const sectionFromToken", "  return {");
  const demoAuditPage = sliceBetween(adminApiSource, "function demoAuditPage", "function saveAudit");
  const openAPIAdminAudit = sliceBetween(openAPISource, "  /admin/audit:", "components:");

  assertIncludes(adminAuditHandler, "parsePositiveIntQuery(r, \"limit\", 50, 1, 100)");
  assertIncludes(auditLogStore, "limit = 50");
  assertIncludes(auditLogStore, "if limit > 100");
  assertIncludes(auditLogStore, "LIMIT $1 OFFSET $2");
  assertIncludes(adminAppSource, "const [auditPage, setAuditPage]");
  assertIncludes(adminAppSource, "setAuditPage(auditPageMeta(response.audit))");
  assertIncludes(auditTab, "const limit = page.limit || 50");
  assertIncludes(auditTab, "onPageChange(offset + limit)");
  assertIncludes(auditPageMeta, "limit: page.limit || 50");
  assertIncludes(fallbackBody, "/api/v1/admin/audit?limit=${options.limit || 50}&offset=${options.offset || 0}");
  assertIncludes(adminApiSource, "limit: options.limit || (tab === \"audit\" ? 50 : 20)");
  assertIncludes(adminApiSource, "response.audit = demoAuditPage(options.limit, options.offset)");
  assertIncludes(demoAuditPage, "entries.slice(safeOffset, safeOffset + safeLimit)");
  assertIncludes(demoAuditPage, "has_more: entries.length > safeOffset + safeLimit");
  assertIncludes(openAPIAdminAudit, "minimum: 1");
  assertIncludes(openAPIAdminAudit, "maximum: 100");
  assertIncludes(openAPIAdminAudit, "default: 50");
});

test("admin analytics stays bounded to presets and limited top dishes", () => {
  const serverSource = readSource("backend/internal/httpapi/server.go");
  const storeSource = readSource("backend/internal/store/store.go");
  const lazyAdminSource = readSource("apps/admin/src/LazyAdminSections.tsx");
  const adminApiSource = readSource("apps/admin/src/api.ts");
  const analyticsRange = sliceBetween(serverSource, "func (s *Server) analyticsPresetRange", "func decodeJSON");
  const analyticsStore = sliceBetween(storeSource, "func (s *Store) AdminAnalytics", "func (s *Store) AuditLog");
  const analyticsTab = sliceBetween(lazyAdminSource, "export function AnalyticsSection", "export function AuditSection");
  const demoAnalytics = sliceBetween(adminApiSource, "function calculateAnalytics", "function groupOrders");

  assertIncludes(adminApiSource, "export type AnalyticsRange = \"today\" | \"7d\" | \"month\"");
  assertIncludes(analyticsTab, "([\"today\", \"7d\", \"month\"] as AnalyticsRange[])");
  assertIncludes(analyticsRange, "case \"\", \"today\":");
  assertIncludes(analyticsRange, "case \"7d\":");
  assertIncludes(analyticsRange, "case \"month\":");
  assertIncludes(analyticsRange, "to.Sub(from) > 370*24*time.Hour");
  assertIncludes(analyticsStore, "LIMIT 10");
  assertIncludes(demoAnalytics, ".slice(0, 10)");
});

test("admin orders backend defaults stay bounded to page size twenty", () => {
  const serverSource = readSource("backend/internal/httpapi/server.go");
  const storeSource = readSource("backend/internal/store/store.go");
  const adminAppSource = readSource("apps/admin/src/App.tsx");
  const adminApiSource = readSource("apps/admin/src/api.ts");
  const openAPISource = readSource("docs/openapi.yaml");
  const adminOrdersHandler = sliceBetween(serverSource, "func (s *Server) adminOrders", "func (s *Server) adminOrder(w");
  const adminOrdersStore = sliceBetween(storeSource, "func (s *Store) AdminOrders", "func (s *Store) AdminOrderByID");
  const adminOrdersPanel = sliceBetween(adminAppSource, "function OrdersTab", "function OrderRow");
  const adminOrderPageMeta = sliceBetween(adminAppSource, "function orderPageMeta", "function ordersLoadFilter");
  const demoAdminOrders = sliceBetween(adminApiSource, "async orders(_token, filter = {})", "    async order(_token, id)");
  const openAPIAdminOrders = sliceBetween(openAPISource, "  /admin/orders:", "  /admin/orders/{id}:");

  assertIncludes(adminOrdersHandler, "parsePositiveIntQuery(r, \"limit\", 20, 1, 50)");
  assertNotIncludes(adminOrdersHandler, "parsePositiveIntQuery(r, \"limit\", 100");
  assertIncludes(adminOrdersStore, "limit = 20");
  assertIncludes(adminOrdersStore, "if limit > 50");
  assertNotIncludes(adminOrdersStore, "limit = 100");
  assertIncludes(adminOrdersPanel, "const limit = page.limit || 20");
  assertIncludes(adminOrderPageMeta, "limit: page.limit || 20");
  assertIncludes(demoAdminOrders, "const limit = filter.limit || 20");
  assertNotIncludes(adminOrdersPanel, "page.limit || 100");
  assertNotIncludes(adminOrderPageMeta, "page.limit || 100");
  assertNotIncludes(demoAdminOrders, "filter.limit || 100");
  assertIncludes(openAPIAdminOrders, "minimum: 1");
  assertIncludes(openAPIAdminOrders, "maximum: 50");
  assertIncludes(openAPIAdminOrders, "default: 20");
  assertNotIncludes(openAPIAdminOrders, "default: 100");
});

test("admin orders date filter stays sargable", () => {
  const storeSource = readSource("backend/internal/store/store.go");
  const adminOrdersStore = sliceBetween(storeSource, "func (s *Store) AdminOrders", "func (s *Store) AdminOrderByID");

  assertIncludes(adminOrdersStore, "time.ParseInLocation(\"2006-01-02\", filter.Date, loc)");
  assertIncludes(adminOrdersStore, "from.UTC()");
  assertIncludes(adminOrdersStore, "from.AddDate(0, 0, 1).UTC()");
  assertIncludes(adminOrdersStore, "o.created_at >= $%d AND o.created_at < $%d");
  assertNotIncludes(adminOrdersStore, "to_char(");
  assertNotIncludes(adminOrdersStore, "created_at::date");
});

test("client order summaries avoid PII while admin pages load details in bulk", () => {
  const storeSource = readSource("backend/internal/store/store.go");
  const clientOrdersStore = sliceBetween(storeSource, "func (s *Store) ClientOrders", "func (s *Store) ClientBootstrapOrders");
  const adminOrdersStore = sliceBetween(storeSource, "func (s *Store) AdminOrders", "func (s *Store) AdminOrderByID");

  assertNotIncludes(clientOrdersStore, "phone_ciphertext");
  assertNotIncludes(clientOrdersStore, "address_ciphertext");
  assertNotIncludes(clientOrdersStore, "order_items");
  assertNotIncludes(clientOrdersStore, "order_events");
  assertIncludes(clientOrdersStore, "scanOrderSummaries(rows)");
  assertNotIncludes(clientOrdersStore, "OrderByID(");
  assertIncludes(adminOrdersStore, "ordersByIDs(ctx, ids, true)");
  assertNotIncludes(adminOrdersStore, "AdminOrderByID(");
});

test("client order endpoints stay scoped to the session user", () => {
  const storeSource = readSource("backend/internal/store/store.go");
  const clientOrdersStore = sliceBetween(storeSource, "func (s *Store) ClientOrders", "func (s *Store) ClientBootstrapOrders");
  const clientBootstrapOrdersStore = sliceBetween(storeSource, "func (s *Store) ClientBootstrapOrders", "func (s *Store) ClientOrderByID");
  const clientOrderDetailStore = sliceBetween(storeSource, "func (s *Store) ClientOrderByID", "func (s *Store) AdminOrders");

  assertIncludes(clientOrdersStore, "WHERE o.client_user_id=$1");
  assertIncludes(clientOrdersStore, "sess.UserID");
  assertIncludes(clientBootstrapOrdersStore, "WHERE o.client_user_id=$1");
  assertIncludes(clientBootstrapOrdersStore, "sess.UserID");
  assertIncludes(clientOrderDetailStore, "WHERE id=$1 AND client_user_id=$2");
  assertIncludes(clientOrderDetailStore, "return core.Order{}, core.ErrForbidden");
});

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing end marker: ${endNeedle}`);
  return source.slice(start, end);
}

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `expected source to include ${needle}`);
}

function assertNotIncludes(source, needle) {
  assert.ok(!source.includes(needle), `expected source not to include ${needle}`);
}
