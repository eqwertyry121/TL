import type { AdminAnalytics, AdminCategory, AdminDashboard, AdminMenuItem, AdminOrderCounts, AnalyticsBreakdown, AuditEntry, AuditLogResponse, Order, OrderSummary, Reservation, ScheduleDay, Settings } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { startVisiblePolling } from "@tk-delivery/api-client/polling";
import type { Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import {
  createAdminApi,
  isAuthError,
  money,
  statusText,
  type AdminBootstrapResponse,
  type AdminMenuResponse,
  type AdminOrdersResponse,
  type AdminSession,
  type AdminTab,
  type AnalyticsRange,
  type CategoryInput,
  type MenuItemInput,
  type SettingsInput,
} from "./api";
import { AlertTriangle, Archive, ArrowLeft, Ban, BarChart3, BellRing, CalendarCheck, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Copy, Home, Menu as MenuIcon, MessageCircle, MoreHorizontal, Phone, RefreshCw, RotateCcw, Save, Search, Send, Settings as SettingsIcon, Shield, SlidersHorizontal, StickyNote, Trash2, Upload, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type FormEvent, type ReactNode } from "react";

const api = createAdminApi();
type AdminNavItem = { id: AdminTab; label: string; shortLabel: string; icon: LucideIcon };
type AdminNavGroup = { title: string; items: AdminNavItem[] };

const tabs: AdminNavItem[] = ([
  { id: "home", label: "Главная", icon: Home },
  { id: "orders", label: "Заказы", icon: ClipboardList },
	{ id: "reservations", label: "Брони", icon: CalendarCheck },
  { id: "menu", label: "Меню", icon: MenuIcon },
  { id: "schedule", label: "График", icon: CalendarDays },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "settings", label: "Настройки", icon: SettingsIcon },
  { id: "audit", label: "Журнал действий", shortLabel: "Журнал", icon: Shield },
] satisfies Array<Omit<AdminNavItem, "shortLabel"> & { shortLabel?: string }>).map((entry) => ({ shortLabel: entry.label, ...entry }));

const navGroups: AdminNavGroup[] = [
  { title: "Работа", items: navItems(["home", "orders", "reservations", "menu"]) },
  { title: "Управление", items: navItems(["schedule", "analytics"]) },
  { title: "Система", items: navItems(["settings", "audit"]) },
];
const mobileTabs = navItems(["home", "orders", "reservations", "menu"]);
const moreTabs = navItems(["schedule", "analytics", "settings", "audit"]);
const moreTabIds = new Set<AdminTab>(moreTabs.map((entry) => entry.id));

const quickSchedule = { open_time: "13:00", order_cutoff_time: "21:00", close_time: "22:00" };
type AdminActionOptions = { reload?: boolean; refreshDashboard?: boolean; successMessage?: string };
type AdminActionRunner = <T>(action: (authToken: string) => Promise<T>, options?: AdminActionOptions) => Promise<T | undefined>;
type AdminLoadKey = "dashboard" | "menu" | "settings" | "schedule" | "orders" | "reservations" | "analytics" | "audit";
type OrdersView = "active" | "new" | "ready" | "history";
type OrderLoadFilter = { status?: string; q?: string; date?: string; limit?: number; offset?: number };
type AdminOrdersPageState = Pick<AdminOrdersResponse, "limit" | "offset" | "has_more" | "counts">;
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  resolve(confirmed: boolean): void;
};
type OrderDialogState =
  | {
    kind: "reason";
    title: string;
    label: string;
    confirmLabel: string;
    variant?: "primary" | "danger";
    onSubmit(reason: string): Promise<void>;
  }
  | {
    kind: "contact";
    order: Order;
    onSubmit(input: { phone: string; address: string; reason: string }): Promise<void>;
  };
const orderViewOptions: Array<{ id: OrdersView; label: string }> = [
  { id: "active", label: "Активные" },
  { id: "new", label: "Кухня" },
  { id: "ready", label: "Готово" },
  { id: "history", label: "История" },
];

export function App() {
  const [token, setToken] = useState("");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [tab, setTabState] = useState<AdminTab>(() => initialAdminTab());
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [menu, setMenu] = useState<AdminMenuResponse>({ categories: [], items: [] });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
	const [reservations, setReservations] = useState<Reservation[]>([]);
	const [reservationAlerts, setReservationAlerts] = useState<Reservation[]>([]);
	const [reservationFocusDate, setReservationFocusDate] = useState("");
  const [ordersPage, setOrdersPage] = useState<AdminOrdersPageState>({ limit: 20, offset: 0, has_more: false });
  const [ordersInitialView, setOrdersInitialView] = useState<OrdersView>("active");
  const [ordersFilter, setOrdersFilter] = useState<OrderLoadFilter>(() => ordersLoadFilter("active", "", "", 20, 0));
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState<Pick<AuditLogResponse, "limit" | "offset" | "has_more">>({ limit: 50, offset: 0, has_more: false });
  const [range, setRange] = useState<AnalyticsRange>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const skipInitialLoadRef = useRef(false);
	const knownReservationIDsRef = useRef<Set<string> | null>(null);
  const activeItem = navItem(tab);
  const activeOrdersCount = (dashboard?.new_orders || 0) + (dashboard?.out_for_delivery || 0) + (dashboard?.ready_for_pickup || 0);
  const ownerAccess = isOwnerTelegramId(session?.telegram_user_id);
	const reservationAlert = reservationAlerts[0] || null;
  const authRetry = useMemo(() => createSingleFlightAuthRetry({
    authenticate,
    isAuthError,
  }), []);

  useEffect(() => installPerformanceBeacon("admin", () => tabFromHash()), []);

  function applySession(nextSession: AdminSession) {
    setSession(nextSession);
    setToken(nextSession.token);
    return nextSession.token;
  }

  async function authenticate() {
    return applySession(await api.authenticate());
  }

  async function refreshAuth() {
    return authRetry.refreshAuth();
  }

  async function withAuth<T>(action: (authToken: string) => Promise<T>, authToken = token): Promise<T> {
    return authRetry.withAuth(action, authToken);
  }

  async function load(authToken = token, analyticsRange = range, targetTab = tab) {
    setLoading(true);
    setError("");
    try {
      let results = await loadAdminSections(authToken || (await refreshAuth()), analyticsRange, targetTab);
      if (results.some((entry) => !entry.ok && isAuthError(entry.reason))) {
        results = await loadAdminSections(await refreshAuth(), analyticsRange, targetTab);
      }

      const failed: AdminLoadKey[] = [];
      for (const entry of results) {
        if (!entry.ok) {
          failed.push(entry.key);
          continue;
        }
        switch (entry.key) {
          case "dashboard":
            setDashboard(entry.value as AdminDashboard);
            break;
          case "menu":
            setMenu(entry.value as AdminMenuResponse);
            break;
          case "settings":
            setSettings(entry.value as Settings);
            break;
          case "schedule":
            setSchedule((entry.value as { schedule: ScheduleDay[] }).schedule);
            break;
          case "orders":
            setOrders((entry.value as AdminOrdersResponse).orders);
            setOrdersPage(orderPageMeta(entry.value as AdminOrdersResponse));
            break;
					case "reservations":
						acceptReservationSnapshot((entry.value as { reservations: Reservation[] }).reservations, ownerAccess);
						break;
          case "analytics":
            setAnalytics(entry.value as AdminAnalytics);
            break;
          case "audit":
            setAudit((entry.value as AuditLogResponse).entries);
            setAuditPage(auditPageMeta(entry.value as AuditLogResponse));
            break;
        }
      }
      if (failed.length) {
        setError(`Не загрузились: ${failed.map(adminLoadLabel).join(", ")}. Остальные данные обновлены.`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  function applyBootstrap(response: AdminBootstrapResponse) {
    applySession(response.session);
    setDashboard(response.dashboard);
    if (response.menu) setMenu(response.menu);
    if (response.settings) setSettings(response.settings);
    if (response.schedule) setSchedule(response.schedule.schedule);
    if (response.orders) {
      setOrders(response.orders.orders);
      setOrdersPage(orderPageMeta(response.orders));
    }
		if (response.reservations) acceptReservationSnapshot(response.reservations.reservations, false);
    if (response.analytics) setAnalytics(response.analytics);
    if (response.audit) {
      setAudit(response.audit.entries);
      setAuditPage(auditPageMeta(response.audit));
    }
  }

  function openTab(nextTab: AdminTab) {
    setTabState(nextTab);
    setMoreOpen(false);
    updateAdminHash(nextTab);
  }

  function openOrdersView(view: OrdersView) {
    setOrdersInitialView(view);
    setOrdersFilter(ordersLoadFilter(view, "", "", 20, 0));
    openTab("orders");
  }

  function askConfirm(input: Omit<ConfirmDialogState, "resolve">): Promise<boolean> {
    return new Promise((resolve) => setConfirmDialog({ ...input, resolve }));
  }

  function closeConfirm(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  function showToast(message: string) {
    setToast(message);
  }

	function acceptReservationSnapshot(next: Reservation[], notifyOwner: boolean) {
		const previous = knownReservationIDsRef.current;
		if (previous && notifyOwner) {
			const newReservations = next
				.filter((reservation) => reservation.status === "CONFIRMED" && !previous.has(reservation.id))
				.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
			if (newReservations.length) {
				setReservationAlerts((current) => [...current, ...newReservations.filter((reservation) => !current.some((queued) => queued.id === reservation.id))]);
			}
		}
		knownReservationIDsRef.current = new Set(next.map((reservation) => reservation.id));
		setReservations(next);
	}

  async function loadAdminSections(authToken: string, analyticsRange: AnalyticsRange, targetTab: AdminTab) {
    const sections: Array<readonly [AdminLoadKey, Promise<unknown>]> = [["dashboard", api.dashboard(authToken)]];
    if (targetTab === "home") {
      sections.push(["settings", api.settings(authToken)]);
    } else if (targetTab === "menu") {
      sections.push(["menu", api.menu(authToken)]);
    } else if (targetTab === "orders") {
      sections.push(["orders", api.orders(authToken, normalizeOrderLoadFilter(ordersFilter))]);
		} else if (targetTab === "reservations") {
			sections.push(["reservations", api.reservations(authToken)]);
    } else if (targetTab === "schedule") {
      sections.push(["schedule", api.schedule(authToken)]);
      sections.push(["settings", api.settings(authToken)]);
    } else if (targetTab === "settings") {
      sections.push(["settings", api.settings(authToken)]);
    } else if (targetTab === "analytics") {
      sections.push(["analytics", api.analytics(authToken, analyticsRange)]);
    } else if (targetTab === "audit") {
      sections.push(["audit", api.audit(authToken, auditPage.limit || 50, auditPage.offset || 0)]);
    }
    return Promise.all(sections.map(async ([key, promise]) => {
      try {
        return { key, ok: true as const, value: await promise };
      } catch (reason) {
        return { key, ok: false as const, reason };
      }
    }));
  }

  async function refreshHomeSection(signal?: AbortSignal, authToken = token) {
    setError("");
    try {
      const currentToken = authToken || (await refreshAuth());
      const [nextDashboard, nextSettings] = await Promise.all([
        withAuth((nextToken) => api.dashboard(nextToken, signal), currentToken),
        withAuth((nextToken) => api.settings(nextToken, signal), currentToken),
      ]);
      setDashboard(nextDashboard);
      setSettings(nextSettings);
    } catch (err) {
      if (signal?.aborted) return;
      setError(errorText(err));
    }
  }

  async function refreshOrdersSection(signal?: AbortSignal, authToken = token) {
    setError("");
    try {
      const currentToken = authToken || (await refreshAuth());
      const filter = normalizeOrderLoadFilter(ordersFilter, ordersPage);
      const [page, nextDashboard] = await Promise.all([
        withAuth((nextToken) => api.orders(nextToken, filter, signal), currentToken),
        withAuth((nextToken) => api.dashboard(nextToken, signal), currentToken),
      ]);
      setOrders(page.orders);
      setOrdersPage(orderPageMeta(page));
      setDashboard(nextDashboard);
    } catch (err) {
      if (signal?.aborted) return;
      setError(errorText(err));
    }
  }

  async function refreshVisibleSection() {
    if (tab === "orders") {
      await refreshOrdersSection();
      return;
    }
    await load(token, range, tab);
  }

  useEffect(() => {
    let stopped = false;
    api.bootstrap(tab, bootstrapOptions(tab, range)).then((response) => {
      if (stopped) return;
      skipInitialLoadRef.current = true;
      applyBootstrap(response);
    }).catch((err) => {
      if (!stopped) setError(errorText(err));
    }).finally(() => {
      if (!stopped) setLoading(false);
    });
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return;
    }
    void load(token, range, tab);
  }, [tab, token]);

  useEffect(() => {
    const onRouteChange = () => {
      setTabState(tabFromHash());
      setMoreOpen(false);
    };
    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
    return () => {
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!token || tab !== "home") return undefined;
    return startVisiblePolling((signal) => refreshHomeSection(signal), 10000);
  }, [tab, token]);

	useEffect(() => {
		if (!token || (!ownerAccess && tab !== "reservations")) return undefined;
		return startVisiblePolling(async (signal) => {
			try {
				const next = (await withAuth((authToken) => api.reservations(authToken, signal))).reservations;
				acceptReservationSnapshot(next, ownerAccess);
			} catch {
				if (!signal.aborted && tab === "reservations") setError("Не удалось обновить брони");
			}
		}, ownerAccess ? 5000 : 10000);
	}, [ownerAccess, tab, token]);

  async function run<T>(action: (authToken: string) => Promise<T>, options: AdminActionOptions = {}): Promise<T | undefined> {
    setError("");
    try {
      const result = await withAuth(action);
      if (options.reload !== false) {
        await load();
      } else if (options.refreshDashboard) {
        try {
          setDashboard(await withAuth((authToken) => api.dashboard(authToken)));
        } catch {
          // Keep successful mutation visible even if a secondary dashboard refresh fails.
        }
      }
      showToast(options.successMessage || "Сохранено");
      return result;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function saveSchedule(next: ScheduleDay[]): Promise<ScheduleDay[]> {
    setError("");
    try {
      const response = await withAuth((authToken) => api.updateSchedule(authToken, next));
      setSchedule(response.schedule);
      try {
        setDashboard(await withAuth((authToken) => api.dashboard(authToken)));
      } catch {
        // The schedule is already saved; a secondary status refresh must not hide that success.
      }
      showToast("График сохранён");
      return response.schedule;
    } catch (err) {
      setError(errorText(err));
      throw err;
    }
  }

  async function loadOrders(filter: OrderLoadFilter, signal?: AbortSignal) {
    setError("");
    const normalizedFilter = normalizeOrderLoadFilter(filter, ordersPage);
    setOrdersFilter(normalizedFilter);
    try {
      const page = await withAuth((authToken) => api.orders(authToken, normalizedFilter, signal));
      setOrders(page.orders);
      setOrdersPage(orderPageMeta(page));
      return page;
    } catch (err) {
      if (signal?.aborted) return undefined;
      setError(errorText(err));
      return undefined;
    }
  }

  async function loadOrderDetail(id: string) {
    setError("");
    try {
      return await withAuth((authToken) => api.order(authToken, id));
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function exportAnalyticsCSV(currentRange: AnalyticsRange) {
    setError("");
    try {
      const blob = await withAuth((authToken) => api.analyticsCSV(authToken, currentRange));
      downloadBlob(blob, `tk-analytics-${currentRange}.csv`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function loadAuditPage(offset: number) {
    setLoading(true);
    setError("");
    try {
      const limit = auditPage.limit || 50;
      const response = await withAuth((authToken) => api.audit(authToken, limit, offset));
      setAudit(response.entries);
      setAuditPage(auditPageMeta(response));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function setDayOff(enabled: boolean) {
    if (enabled) {
      const confirmed = await askConfirm({
        title: "Остановить приём?",
        message: "Новые заказы будут недоступны. Активные заказы останутся в работе.",
        confirmLabel: "Остановить",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    await run((authToken) => api.setManualDayOff(authToken, enabled));
  }

	async function cancelBooking(reservation: Reservation) {
		const confirmed = await askConfirm({
			title: "Освободить стол?",
			message: `${formatReservationAdminDate(reservation.date)} в ${reservation.start_hour}:00 · ${reservation.guests} гостей`,
			confirmLabel: "Освободить",
			variant: "danger",
		});
		if (!confirmed) return;
		await run((authToken) => api.cancelReservation(authToken, reservation.id), { successMessage: "Стол освобождён" });
	}

  function renderActiveTab() {
    if (tab === "home") {
      return dashboard && settings ? (
        <HomeTab
          dashboard={dashboard}
          settings={settings}
          onDayOff={setDayOff}
          onOpenOrders={openOrdersView}
          onOpenMenu={() => openTab("menu")}
          onOpenSchedule={() => openTab("schedule")}
          onOpenAnalytics={() => openTab("analytics")}
        />
      ) : <SectionSkeleton title="Главная" />;
    }
    if (tab === "orders") return <OrdersTab orders={orders} page={ordersPage} initialView={ordersInitialView} onLoad={loadOrders} onLoadOrder={loadOrderDetail} onAction={run} />;
		if (tab === "reservations") return <ReservationsTab reservations={reservations} focusDate={reservationFocusDate} onCancel={cancelBooking} />;
    if (tab === "menu") return <MenuTab menu={menu} onAction={run} />;
    if (tab === "schedule") {
      return schedule.length && dashboard && settings ? (
        <ScheduleTab
          schedule={schedule}
          runtime={dashboard.runtime}
          manualDayOff={settings.manual_day_off}
          onSave={saveSchedule}
        />
      ) : <SectionSkeleton title="График" />;
    }
    if (tab === "analytics") {
      return analytics ? <AnalyticsTab analytics={analytics} range={range} onRange={(next) => { setRange(next); void load(token, next); }} onExport={() => void exportAnalyticsCSV(range)} /> : <SectionSkeleton title="Аналитика" />;
    }
    if (tab === "settings") {
      return settings ? <SettingsTab settings={settings} demoMode={api.mode === "demo"} onSave={(input) => run((authToken) => api.updateSettings(authToken, input)).then(() => undefined)} /> : <SectionSkeleton title="Настройки" />;
    }
    if (tab === "audit") return <AuditTab entries={audit} page={auditPage} onPageChange={loadAuditPage} />;
    return <SectionSkeleton title={activeItem.label} />;
  }

  return (
    <div className="admin">
      <aside className="sidebar" aria-label="Навигация админки">
        <div className="brand">
          <strong>Tako Lako</strong>
          <span>админка</span>
        </div>
        <SidebarNav activeTab={tab} onSelect={openTab} />
      </aside>
      <main className="admin-main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{activeItem.label}</h1>
          </div>
          <div className="topbar-actions">
            <RestaurantStatus dashboard={dashboard} loading={loading} />
            <button className="profile-button" type="button" onClick={() => setMoreOpen(true)} aria-label="Открыть меню">
              <AdminAvatar session={session} />
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>
		{ownerAccess && reservationAlert && (
			<aside className="owner-reservation-alert" role="alert">
				<button
					className="owner-reservation-alert-content"
					onClick={() => {
						setReservationFocusDate(reservationAlert.date);
						setReservationAlerts((current) => current.slice(1));
						openTab("reservations");
					}}
					type="button"
				>
					<span className="owner-reservation-alert-icon"><BellRing size={20} /></span>
					<span>
						<strong>{reservationAlert.table_label} забронирован на {String(reservationAlert.start_hour).padStart(2, "0")}:00</strong>
						<small>{formatReservationShortDate(reservationAlert.date)} · {guestCountLabel(reservationAlert.guests)}</small>
					</span>
				</button>
				<button className="owner-reservation-alert-close" aria-label="Закрыть уведомление" onClick={() => setReservationAlerts((current) => current.slice(1))} type="button"><X size={18} /></button>
			</aside>
		)}
        {error && <div className="error"><AlertTriangle size={18} /> {error}</div>}
        <SectionErrorBoundary resetKey={tab}>
          {renderActiveTab()}
        </SectionErrorBoundary>
      </main>
      <MobileNav activeTab={tab} activeOrdersCount={activeOrdersCount} onSelect={openTab} onMore={() => setMoreOpen(true)} />
      {moreOpen && (
        <MoreSheet
          activeTab={tab}
          loading={loading}
          session={session}
          ownerAccess={ownerAccess}
          onClose={() => setMoreOpen(false)}
          onRefresh={() => {
            setMoreOpen(false);
            void refreshVisibleSection();
          }}
          onSelect={openTab}
        />
      )}
      <ConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

class SectionErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void error;
    void info;
    console.error("Admin section render error");
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel section-error">
        <AlertTriangle size={18} />
        <div>
          <h2>Раздел не загрузился</h2>
          <p className="muted">Обновите раздел или откройте другую вкладку.</p>
        </div>
      </section>
    );
  }
}

function SidebarNav({ activeTab, onSelect }: { activeTab: AdminTab; onSelect(tab: AdminTab): void }) {
  return (
    <nav className="side-nav">
      {navGroups.map((group) => (
        <div className="side-nav-group" key={group.title}>
          <span className="side-nav-title">{group.title}</span>
          {group.items.map((entry) => <NavButton key={entry.id} item={entry} active={activeTab === entry.id} onSelect={onSelect} />)}
        </div>
      ))}
    </nav>
  );
}

function MobileNav({ activeTab, activeOrdersCount, onSelect, onMore }: { activeTab: AdminTab; activeOrdersCount: number; onSelect(tab: AdminTab): void; onMore(): void }) {
  const moreActive = moreTabIds.has(activeTab);
  return (
    <nav className="mobile-nav" aria-label="Основные разделы">
      {mobileTabs.map((entry) => (
        <NavButton
          key={entry.id}
          item={entry}
          active={activeTab === entry.id}
          badge={entry.id === "orders" && activeOrdersCount > 0 ? activeOrdersCount : 0}
          mobile
          onSelect={onSelect}
        />
      ))}
      <button className={moreActive ? "active" : ""} type="button" onClick={onMore}>
        <MoreHorizontal size={19} />
        <span>Ещё</span>
      </button>
    </nav>
  );
}

function NavButton({ item, active, badge = 0, mobile = false, onSelect }: { item: AdminNavItem; active: boolean; badge?: number; mobile?: boolean; onSelect(tab: AdminTab): void }) {
  const Icon = item.icon;
  return (
    <button className={active ? "active" : ""} type="button" onClick={() => onSelect(item.id)} title={item.label}>
      <Icon size={mobile ? 19 : 18} />
      <span>{mobile ? item.shortLabel : item.label}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

function MoreSheet({
  activeTab,
  loading,
  session,
  ownerAccess,
  onClose,
  onRefresh,
  onSelect,
}: {
  activeTab: AdminTab;
  loading: boolean;
  session: AdminSession | null;
  ownerAccess: boolean;
  onClose(): void;
  onRefresh(): void;
  onSelect(tab: AdminTab): void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="more-sheet" role="dialog" aria-modal="true" aria-label="Ещё" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h2>Ещё</h2>
            {ownerAccess && session?.telegram_user_id && <p className="muted">ID {session.telegram_user_id}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="more-list">
          {moreTabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.id} className={activeTab === entry.id ? "active" : ""} type="button" onClick={() => onSelect(entry.id)}>
                <Icon size={18} />
                <span>{entry.label}</span>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </div>
        <div className="sheet-section">
          <button type="button" onClick={onRefresh} disabled={loading}><RefreshCw size={17} /> Обновить</button>
        </div>
        {ownerAccess && (
          <div className="sheet-section">
            <span className="sheet-caption">Роли owner</span>
            <OwnerRoleSwitch activeRole="ADMIN" />
          </div>
        )}
      </section>
    </div>
  );
}

function RestaurantStatus({ dashboard, loading }: { dashboard: AdminDashboard | null; loading: boolean }) {
  if (!dashboard) return <span className="restaurant-status is-pending">{loading ? "Загрузка" : "Статус"}</span>;
  const accepting = dashboard.runtime.accepting_orders;
  return <span className={accepting ? "restaurant-status is-open" : "restaurant-status is-closed"}>{accepting ? "Принимаем заказы" : "Приём остановлен"}</span>;
}

function AdminAvatar({ session }: { session: AdminSession | null }) {
  if (session?.photo_url) return <img className="admin-avatar" src={session.photo_url} alt="" />;
  const initial = (session?.first_name || session?.username || "A").trim().slice(0, 1).toUpperCase() || "A";
  return <span className="admin-avatar" aria-hidden="true">{initial}</span>;
}

function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmDialogState | null; onClose(confirmed: boolean): void }) {
  if (!dialog) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => onClose(false)}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => onClose(false)}>{dialog.cancelLabel || "Отмена"}</button>
          <button className={dialog.variant === "danger" ? "danger-button" : "primary"} type="button" onClick={() => onClose(true)}>{dialog.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="panel section-skeleton" aria-busy="true">
      <h2>{title}</h2>
      <div className="skeleton-line wide-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line short-line" />
    </section>
  );
}

function OwnerRoleSwitch({ activeRole }: { activeRole: Role }) {
  return (
    <div className="role-switch" aria-label="Переключение роли owner">
      {roleLinks(activeRole).map((link) => (
        <a key={link.role} className={link.active ? "active" : ""} href={link.href}>
          {link.label}
        </a>
      ))}
    </div>
  );
}

function HomeTab({
  dashboard,
  settings,
  onDayOff,
  onOpenOrders,
  onOpenMenu,
  onOpenSchedule,
  onOpenAnalytics,
}: {
  dashboard: AdminDashboard;
  settings: Settings;
  onDayOff(enabled: boolean): Promise<void>;
  onOpenOrders(view: OrdersView): void;
  onOpenMenu(): void;
  onOpenSchedule(): void;
  onOpenAnalytics(): void;
}) {
  const accepting = dashboard.runtime.accepting_orders;
  const notificationErrors = dashboard.notification_errors ?? [];
  const readyOrders = dashboard.out_for_delivery + dashboard.ready_for_pickup;
  const activeOrders = dashboard.new_orders + readyOrders;
  return (
    <section className="home-dashboard">
      <div className={`panel home-status ${accepting ? "is-open" : "is-closed"}`}>
        <div>
          <span className="status-dot-label"><span className="status-dot" /> {accepting ? "Приём открыт" : "Приём закрыт"}</span>
          <h2>{accepting ? "Работаем" : "Заказы не принимаются"}</h2>
          <p>{compactRuntimeReason(dashboard.runtime.reason)}</p>
        </div>
        <button className={settings.manual_day_off ? "primary" : "danger-button"} onClick={() => void onDayOff(!settings.manual_day_off)}>
          {settings.manual_day_off ? "Возобновить" : "Стоп приём"}
        </button>
      </div>

      <div className="home-section">
        <div className="home-section-head">
          <div>
            <h2>Активные заказы</h2>
            <p className="muted">{activeOrders ? "Нужно контролировать сейчас" : "Очередь пустая"}</p>
          </div>
          <button type="button" onClick={() => onOpenOrders("active")}>Открыть</button>
        </div>
        <div className="home-counters">
          <button className="home-counter" type="button" onClick={() => onOpenOrders("new")}>
            <span>На кухне</span>
            <strong>{dashboard.new_orders}</strong>
          </button>
          <button className="home-counter" type="button" onClick={() => onOpenOrders("ready")}>
            <span>Готово</span>
            <strong>{readyOrders}</strong>
          </button>
          <button className="home-counter" type="button" onClick={() => onOpenOrders("ready")}>
            <span>Самовывоз</span>
            <strong>{dashboard.ready_for_pickup}</strong>
          </button>
        </div>
      </div>

      <div className="panel today-card">
        <h2>Сегодня</h2>
        <div className="today-metrics">
          <div><span>Заказы</span><strong>{dashboard.orders_today}</strong></div>
          <div><span>Выручка</span><strong>{money(dashboard.revenue_today_minor)}</strong></div>
        </div>
      </div>

      {notificationErrors.length > 0 && (
        <div className="panel attention-card">
          <h2>Нужно проверить</h2>
          {notificationErrors.slice(0, 3).map((item) => <p key={item}>{item}</p>)}
          {notificationErrors.length > 3 && <p className="muted">+ ещё {notificationErrors.length - 3}</p>}
        </div>
      )}

      <div className="quick-actions">
        <button type="button" onClick={onOpenMenu}>Меню</button>
        <button type="button" onClick={onOpenSchedule}>График</button>
        <button type="button" onClick={onOpenAnalytics}>Аналитика</button>
      </div>
    </section>
  );
}

type MenuMode = "items" | "categories";
const comboCategoryID = "66666666-6666-6666-6666-666666666001";

function MenuTab({ menu, onAction }: { menu: AdminMenuResponse; onAction: AdminActionRunner }) {
  const [mode, setMode] = useState<MenuMode>("items");
  const [cat, setCat] = useState<AdminCategory | null>(null);
  const [item, setItem] = useState<AdminMenuItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const activeCategories = menu.categories.filter((entry) => !entry.archived);
  const filteredCategories = showArchived ? menu.categories : activeCategories;
  const filteredItems = (showArchived ? menu.items : menu.items.filter((entry) => !entry.archived))
    .filter((entry) => categoryFilter === "all" || entry.category_id === categoryFilter);
  const newItemCategory = activeCategories.find((entry) => entry.id === categoryFilter) || activeCategories[0];

  function openCategory(category: AdminCategory) {
    setMode("categories");
    setCat(category);
    setItem(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openItem(dish: AdminMenuItem) {
    setMode("items");
    setItem(dish);
    setCat(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleCategory(category: AdminCategory) {
    await onAction((authToken) => api.updateCategory(authToken, category.id, categoryInputFromForm({ ...category, visible: !category.visible })), {
      successMessage: category.visible ? "Категория скрыта" : "Категория в меню",
    });
  }

  async function toggleDish(dish: AdminMenuItem) {
    await onAction((authToken) => api.updateItem(authToken, dish.id, dishInputFromForm({ ...dish, visible: !dish.visible })), {
      successMessage: dish.visible ? "Блюдо скрыто" : "Блюдо в меню",
    });
  }

  return (
    <section className="stack">
      <div className="panel menu-toolbar">
        <div>
          <h2>Меню</h2>
          <div className="segmented compact-segmented" role="tablist" aria-label="Раздел меню">
            <button className={mode === "items" ? "active" : ""} type="button" onClick={() => { setMode("items"); setCat(null); }}>
              Блюда
            </button>
            <button className={mode === "categories" ? "active" : ""} type="button" onClick={() => { setMode("categories"); setItem(null); }}>
              Категории
            </button>
          </div>
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={mode === "items" && !activeCategories.length}
            onClick={() => mode === "items" ? openItem(emptyItem(newItemCategory?.id || "")) : openCategory(emptyCategory())}
          >
            + Добавить
          </button>
          <button type="button" onClick={() => setShowArchived((value) => !value)}>
            <MoreHorizontal size={16} /> {showArchived ? "Скрыть архив" : "Архив"}
          </button>
        </div>
      </div>

      {mode === "items" && (
        <>
          <div className="category-chips" aria-label="Фильтр по категории">
            <button className={categoryFilter === "all" ? "active" : ""} type="button" onClick={() => setCategoryFilter("all")}>Все</button>
            {activeCategories.map((category) => (
              <button
                className={categoryFilter === category.id ? "active" : ""}
                type="button"
                key={category.id}
                onClick={() => setCategoryFilter(category.id)}
              >
                {category.title_ru || "Без названия"}
              </button>
            ))}
          </div>
          {categoryFilter === comboCategoryID && (
            <div className="panel attention-card">
              <strong>Настройка комбо</strong>
              <p>Каждая позиция здесь показывается клиенту большой карточкой. Состав укажите в названии и описании; цену, фото, порядок и видимость можно менять как у обычного блюда.</p>
            </div>
          )}
        </>
      )}

      {cat && (
        <CategoryForm
          category={cat}
          onCancel={() => setCat(null)}
          onSave={(input) => onAction((authToken) => cat.id ? api.updateCategory(authToken, cat.id, input) : api.createCategory(authToken, input)).then(() => setCat(null))}
          onArchive={cat.id ? () => onAction((authToken) => api.archiveCategory(authToken, cat.id, "archive from admin editor"), { successMessage: "Категория в архиве" }).then(() => setCat(null)) : undefined}
          onDelete={cat.id ? () => onAction((authToken) => api.deleteCategory(authToken, cat.id, "delete/archive from admin editor"), { successMessage: "Категория удалена" }).then(() => setCat(null)) : undefined}
        />
      )}
      {item && (
        <DishForm
          item={item}
          categories={activeCategories}
          onCancel={() => setItem(null)}
          onUpload={(file) => onAction((authToken) => api.uploadMenuPhoto(authToken, file))}
          onSave={(input) => onAction((authToken) => item.id ? api.updateItem(authToken, item.id, input) : api.createItem(authToken, input)).then(() => setItem(null))}
          onArchive={item.id ? () => onAction((authToken) => api.archiveItem(authToken, item.id, "archive from admin editor"), { successMessage: "Блюдо в архиве" }).then(() => setItem(null)) : undefined}
          onDelete={item.id ? () => onAction((authToken) => api.deleteItem(authToken, item.id, "delete/archive from admin editor"), { successMessage: "Блюдо удалено" }).then(() => setItem(null)) : undefined}
        />
      )}

      <div className="panel menu-list-panel">
        {mode === "categories" ? (
          <>
            <h2>Категории</h2>
            {filteredCategories.length === 0 ? <p className="muted">Категорий нет</p> : filteredCategories.map((category) => (
              <div className="row menu-row" key={category.id}>
                <button className="menu-row-open" type="button" onClick={() => openCategory(category)}>
                  <strong>{category.title_ru || "Без названия"}</strong>
                  <span>{category.item_count} блюд</span>
                </button>
                {category.archived ? (
                  <button className="primary" onClick={() => void onAction((authToken) => api.restoreCategory(authToken, category.id, "restore from admin"))}>Восстановить</button>
                ) : (
                  <label className="visibility-switch">
                    <input type="checkbox" checked={category.visible} onChange={() => void toggleCategory(category)} />
                    <span>{category.visible ? "В меню" : "Скрыта"}</span>
                  </label>
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            <h2>Блюда</h2>
            {filteredItems.length === 0 ? <p className="muted">Блюд нет</p> : filteredItems.map((dish) => {
              const preview = adminPhotoPreview(dish);
              return (
                <div className="row menu-row dish-menu-row" key={dish.id}>
                  <button className="menu-row-open dish-row-open" type="button" onClick={() => openItem(dish)}>
                    <span className="dish-thumb">{preview.url ? <img src={preview.url} width={preview.width} height={preview.height} alt="" loading="lazy" decoding="async" /> : "🍽️"}</span>
                    <span>
                      <strong>{dish.title_ru || "Без названия"}</strong>
                      <span>{categoryTitle(menu.categories, dish.category_id)}</span>
                    </span>
                  </button>
                  <strong className="menu-price">{money(dish.price_minor)}</strong>
                  {dish.archived ? (
                    <button className="primary" onClick={() => void onAction((authToken) => api.restoreItem(authToken, dish.id, "restore from admin"))}>Восстановить</button>
                  ) : (
                    <label className="visibility-switch">
                      <input type="checkbox" checked={dish.visible} onChange={() => void toggleDish(dish)} />
                      <span>{dish.visible ? "В меню" : "Скрыто"}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function CategoryForm({
  category,
  onSave,
  onCancel,
  onArchive,
  onDelete,
}: {
  category: AdminCategory;
  onSave(input: CategoryInput): Promise<void>;
  onCancel(): void;
  onArchive?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState(category);
  return (
    <div className="panel editor">
      <div className="editor-head">
        <div>
          <h2>{category.id ? "Категория" : "Новая категория"}</h2>
        </div>
        <button onClick={onCancel}>Закрыть</button>
      </div>
      <div className="form-grid">
        <Text label="Название RU" value={form.title_ru} onChange={(title_ru) => setForm({ ...form, title_ru })} />
      </div>
      <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /> Показывать клиентам</label>
      <details className="advanced-fields">
        <summary>Переводы и порядок</summary>
        <div className="advanced-fields-body">
          <div className="form-grid">
            <Text label="Название SR-Latn" value={form.title_sr} onChange={(title_sr) => setForm({ ...form, title_sr })} />
            <Text label="Название EN" value={form.title_en} onChange={(title_en) => setForm({ ...form, title_en })} />
            <NumberInput label="Порядок" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
          </div>
        </div>
      </details>
      <div className="actions">
        <button className="primary" onClick={() => void onSave(categoryInputFromForm(form))}><Save size={16} /> Сохранить</button>
        <button onClick={onCancel}>Отмена</button>
      </div>
      {(onArchive || onDelete) && !category.archived && (
        <details className="advanced-fields danger-zone">
          <summary>Опасные действия</summary>
          <div className="advanced-fields-body danger-actions">
            {onArchive && <button type="button" onClick={() => void onArchive()}><Archive size={16} /> В архив</button>}
            {onDelete && <button className="danger-button" type="button" onClick={() => void onDelete()}><Trash2 size={16} /> Удалить</button>}
          </div>
        </details>
      )}
    </div>
  );
}

function DishForm({
  item,
  categories,
  onSave,
  onCancel,
  onUpload,
  onArchive,
  onDelete,
}: {
  item: AdminMenuItem;
  categories: AdminCategory[];
  onSave(input: MenuItemInput): Promise<void>;
  onCancel(): void;
  onUpload(file: File): Promise<unknown>;
  onArchive?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState(item);
  const preview = adminPhotoPreview(form);
  const update = (patch: Partial<AdminMenuItem>) => setForm((current) => ({ ...current, ...patch }));
  async function upload(file?: File) {
    if (!file) return;
    const response = await onUpload(file);
    const photoPath = typeof response === "object" && response && "photo_path" in response ? String((response as { photo_path?: unknown }).photo_path || "") : "";
    const photoVariants = typeof response === "object" && response && "photo_variants" in response
      ? (response as { photo_variants?: AdminMenuItem["photo_variants"] }).photo_variants
      : undefined;
    if (photoPath) setForm((current) => ({ ...current, photo_path: photoPath, photo_variants: photoVariants }));
  }
  return (
    <div className="panel editor">
      <div className="editor-head">
        <div>
          <h2>{item.id ? "Блюдо" : "Новое блюдо"}</h2>
        </div>
        <button onClick={onCancel}>Закрыть</button>
      </div>
      <div className="editor-layout">
        <div className="photo-panel">
          <label className="upload primary-upload"><Upload size={16} /> Заменить фото <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} /></label>
          {preview.url ? (
            <div className="photo-preview">
              <img src={preview.url} width={preview.width} height={preview.height} alt="" loading="lazy" decoding="async" />
              <span>Фото блюда</span>
            </div>
          ) : <p className="muted">Фото не загружено</p>}
          {form.photo_path && <button type="button" onClick={() => update({ photo_path: "", photo_variants: undefined })}>Удалить фото</button>}
        </div>
        <div className="editor-main">
          <div className="form-grid primary-fields">
            <Text label="Название" value={form.title_ru} onChange={(title_ru) => update({ title_ru })} />
            <NumberInput label="Цена, RSD" value={form.price_minor} onChange={(price_minor) => update({ price_minor })} />
            <label><span>Категория</span><select value={form.category_id} onChange={(event) => update({ category_id: event.target.value })}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.title_ru}</option>)}
            </select></label>
          </div>
          <Textarea label="Описание" value={form.description_ru} onChange={(description_ru) => update({ description_ru })} />
          <div className="form-grid compact-fields">
            <NumberInput label="Минимум, шт" value={form.min_quantity || 1} onChange={(min_quantity) => update({ min_quantity: Math.max(1, min_quantity) })} />
            <Text label="Вес/порция" value={form.weight_text} onChange={(weight_text) => update({ weight_text })} />
          </div>
          <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => update({ visible: event.target.checked })} /> Показывать клиентам</label>
        </div>
      </div>
      <details className="advanced-fields">
        <summary>Переводы</summary>
        <div className="advanced-fields-body">
          <div className="form-grid">
            <Text label="Название SR-Latn" value={form.title_sr} onChange={(title_sr) => update({ title_sr })} />
            <Text label="Название EN" value={form.title_en} onChange={(title_en) => update({ title_en })} />
          </div>
          <div className="form-grid">
            <Textarea label="Описание SR-Latn" value={form.description_sr} onChange={(description_sr) => update({ description_sr })} />
            <Textarea label="Описание EN" value={form.description_en} onChange={(description_en) => update({ description_en })} />
          </div>
        </div>
      </details>
      <details className="advanced-fields">
        <summary>Аллергены и порядок</summary>
        <div className="advanced-fields-body">
          <div className="form-grid">
            <Text label="Аллергены RU" value={form.allergen_text_ru} onChange={(allergen_text_ru) => update({ allergen_text_ru })} />
            <Text label="Аллергены SR-Latn" value={form.allergen_text_sr} onChange={(allergen_text_sr) => update({ allergen_text_sr })} />
            <Text label="Аллергены EN" value={form.allergen_text_en} onChange={(allergen_text_en) => update({ allergen_text_en })} />
            <NumberInput label="Порядок" value={form.sort_order} onChange={(sort_order) => update({ sort_order })} />
          </div>
        </div>
      </details>
      {item.id && item.price_minor !== form.price_minor && <div className="warn">Цена изменится: {money(item.price_minor)} → {money(form.price_minor)}.</div>}
      <div className="actions">
        <button className="primary" onClick={() => void onSave(dishInputFromForm(form))}><Save size={16} /> Сохранить</button>
        <button onClick={onCancel}>Отмена</button>
      </div>
      {(onArchive || onDelete) && !item.archived && (
        <details className="advanced-fields danger-zone">
          <summary>Опасные действия</summary>
          <div className="advanced-fields-body danger-actions">
            {onArchive && <button type="button" onClick={() => void onArchive()}><Archive size={16} /> В архив</button>}
            {onDelete && <button className="danger-button" type="button" onClick={() => void onDelete()}><Trash2 size={16} /> Удалить</button>}
          </div>
        </details>
      )}
    </div>
  );
}

function ReservationsTab({ reservations, focusDate, onCancel }: { reservations: Reservation[]; focusDate: string; onCancel(reservation: Reservation): void }) {
  const days = useMemo(() => reservationAdminDays(7), []);
  const [selectedDate, setSelectedDate] = useState(days[0]);
	const selectedReservations = reservations.filter((reservation) => reservation.date === selectedDate && reservation.status === "CONFIRMED");
	const activeCount = selectedReservations.length;

	useEffect(() => {
		if (focusDate && days.includes(focusDate)) setSelectedDate(focusDate);
	}, [days, focusDate]);

  return (
    <div className="admin-stack reservations-admin">
		<details className="reservation-day-select">
			<summary aria-label="Выберите день">
				<span><small>День</small><strong>{formatReservationAdminDate(selectedDate)}</strong></span>
				<span className="reservation-day-select-meta">{activeCount > 0 ? activeCount : "Нет броней"}<ChevronDown size={18} /></span>
			</summary>
			<div className="reservation-day-options" role="listbox" aria-label="Дни с бронями">
				{days.map((date) => {
					const count = reservations.filter((reservation) => reservation.date === date && reservation.status === "CONFIRMED").length;
					return (
						<button
							aria-selected={date === selectedDate}
							className={date === selectedDate ? "reservation-day-option is-active" : "reservation-day-option"}
							key={date}
							onClick={(event) => {
								setSelectedDate(date);
								event.currentTarget.closest("details")?.removeAttribute("open");
							}}
							role="option"
							type="button"
						>
							<span><strong>{formatReservationWeekday(date)}</strong><small>{formatReservationShortDate(date)}</small></span>
							<span className={count > 0 ? "reservation-option-count has-bookings" : "reservation-option-count"}>{count}</span>
						</button>
					);
				})}
			</div>
		</details>

      <section className="panel reservation-day-panel">
        <div className="section-heading reservation-day-heading">
          <div><h2>{formatReservationAdminDate(selectedDate)}</h2></div>
          {activeCount > 0 && <span className="reservation-day-count">{activeCount}</span>}
        </div>
        {selectedReservations.length > 0 ? (
          <div className="reservation-admin-list">
            {selectedReservations.map((reservation) => {
              const username = (reservation.client_username || "").replace(/^@/, "");
              const client = username ? `@${username}` : reservation.client_first_name || "Клиент";
              return (
                <article className="reservation-admin-row" key={reservation.id}>
                  <div className="reservation-admin-time"><strong>{reservation.start_hour}:00</strong><span>{reservation.end_hour}:00</span></div>
                  <div className="reservation-admin-main">
                    <strong>{username ? (
                      <a
                        href={`https://t.me/${username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => {
                          event.preventDefault();
                          openTelegramLink(`https://t.me/${username}`);
                        }}
                      >
                        {client}
                      </a>
                    ) : client}</strong>
                    <span>{reservation.guests} гостей · {reservation.table_label}</span>
                  </div>
                  <button className="danger-outline" type="button" onClick={() => onCancel(reservation)}>Освободить</button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="reservation-day-empty"><CalendarCheck size={22} /><span>Броней нет</span></div>
        )}
      </section>
    </div>
  );
}

function formatReservationAdminDate(date: string): string {
  return capitalize(new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Belgrade" }).format(reservationDate(date)));
}

function formatReservationWeekday(date: string): string {
  return capitalize(new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "Europe/Belgrade" }).format(reservationDate(date)));
}

function formatReservationShortDate(date: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Belgrade" }).format(reservationDate(date)).replace(".", "");
}

function guestCountLabel(count: number): string {
	const tens = count % 100;
	const units = count % 10;
	if (tens >= 11 && tens <= 14) return `${count} гостей`;
	if (units === 1) return `${count} гость`;
	if (units >= 2 && units <= 4) return `${count} гостя`;
	return `${count} гостей`;
}

function reservationDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function reservationAdminDays(count: number): string[] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  const start = new Date(Date.UTC(value("year"), value("month") - 1, value("day"), 12));
  return Array.from({ length: count }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
  });
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1) : value;
}

function OrdersTab({
  orders,
  page,
  initialView,
  onLoad,
  onLoadOrder,
  onAction,
}: {
  orders: OrderSummary[];
  page: AdminOrdersPageState;
  initialView: OrdersView;
  onLoad(filter: OrderLoadFilter, signal?: AbortSignal): Promise<AdminOrdersResponse | undefined>;
  onLoadOrder(id: string): Promise<Order | undefined>;
  onAction: AdminActionRunner;
}) {
  const [view, setView] = useState<OrdersView>(initialView);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedID, setSelectedID] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionMenuID, setActionMenuID] = useState("");
  const [dialog, setDialog] = useState<OrderDialogState | null>(null);
  const limit = page.limit || 20;
  const offset = page.offset || 0;
  const counts = useMemo(() => page.counts || fallbackOrderCounts(orders), [orders, page.counts]);
  const visibleOrders = orders;
  const selectedOrder = detail;
  const onLoadRef = useRef(onLoad);
  const onLoadOrderRef = useRef(onLoadOrder);
  const newestOrderIDRef = useRef("");

  useEffect(() => {
    onLoadRef.current = onLoad;
    onLoadOrderRef.current = onLoadOrder;
  }, [onLoad, onLoadOrder]);

  useEffect(() => {
    setView(initialView);
    setSelectedID("");
    setDetail(null);
    setActionMenuID("");
    void onLoadRef.current(ordersLoadFilter(initialView, "", "", limit, 0));
  }, [initialView, limit]);

  useEffect(() => {
    return startVisiblePolling(async (signal) => {
      await onLoadRef.current(ordersLoadFilter(view, query, date, limit, offset), signal);
      if (signal.aborted || !selectedID) return;
      const loaded = await onLoadOrderRef.current(selectedID);
      if (!signal.aborted) setDetail(loaded || null);
    }, 5000);
  }, [date, limit, offset, query, selectedID, view]);

  useEffect(() => {
    if (view === "history") return;
    const newestOrder = orders[0];
    if (!newestOrder) {
      newestOrderIDRef.current = "";
      return;
    }
    const isNewArrival = newestOrderIDRef.current !== newestOrder.id;
    newestOrderIDRef.current = newestOrder.id;
    if (!selectedID && isNewArrival) void selectOrder(newestOrder);
  }, [orders, selectedID, view]);

  async function applyFilter(nextOffset = 0) {
    setSelectedID("");
    setDetail(null);
    setActionMenuID("");
    await onLoad(ordersLoadFilter(view, query, date, limit, nextOffset));
  }

  async function resetFilter() {
    setView("active");
    setQuery("");
    setDate("");
    setFiltersOpen(false);
    setSelectedID("");
    setDetail(null);
    setActionMenuID("");
    await onLoad(ordersLoadFilter("active", "", "", limit, 0));
  }

  async function selectOrder(order: OrderSummary) {
    setSelectedID(order.id);
    setDetail(null);
    setActionMenuID("");
    setDetailLoading(true);
    try {
      const loaded = await onLoadOrder(order.id);
      setDetail(loaded || null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function executeOrderAction<T>(action: (authToken: string) => Promise<T>) {
    const result = await onAction(action, { reload: false, refreshDashboard: true });
    if (isOrderResponse(result)) {
      setDetail(result);
      setSelectedID(result.id);
    }
    await onLoad(ordersLoadFilter(view, query, date, limit, offset));
    setActionMenuID("");
  }

  function openReasonDialog(input: Omit<Extract<OrderDialogState, { kind: "reason" }>, "kind">) {
    setDialog({ kind: "reason", ...input });
    setActionMenuID("");
  }

  function openContactDialog(order: Order) {
    setDialog({
      kind: "contact",
      order,
      onSubmit: (input) => executeOrderAction((authToken) => api.updateOrderContact(authToken, order.id, input)).then(() => undefined),
    });
    setActionMenuID("");
  }

  return (
    <section className={`orders-workspace ${selectedID ? "has-detail" : ""}`}>
      <div className="orders-list-panel">
        <div className="order-segments" role="tablist" aria-label="Фильтр заказов">
          {orderViewOptions.map((entry) => (
            <button
              key={entry.id}
              className={view === entry.id ? "active" : ""}
              type="button"
              onClick={() => {
                setView(entry.id);
                setSelectedID("");
                setDetail(null);
                void onLoad(ordersLoadFilter(entry.id, query, date, limit, 0));
              }}
            >
              <span>{entry.label}</span>
              <strong>{counts[entry.id]}</strong>
            </button>
          ))}
        </div>

        <div className="order-filter-bar">
          <label className="order-search">
            <Search size={17} />
            <input placeholder="№, телефон, @username" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
            <SlidersHorizontal size={17} />
          </button>
        </div>

        {filtersOpen && (
          <div className="order-filter-drawer">
            <label><span>Дата</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <div className="actions">
              <button className="primary" type="button" onClick={() => void applyFilter(0)}>Применить</button>
              <button type="button" onClick={() => void resetFilter()}>Сбросить</button>
            </div>
          </div>
        )}

        <div className="orders-list" role="list">
          {visibleOrders.length === 0 ? (
            <div className="empty compact-empty">
              <strong>Заказов нет</strong>
              <span>{view === "active" ? "Активная очередь пустая" : "По фильтру ничего не найдено"}</span>
            </div>
          ) : visibleOrders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              selected={selectedID === order.id}
              onSelect={() => void selectOrder(order)}
            />
          ))}
        </div>

        {(offset > 0 || page.has_more) && (
          <div className="orders-pagination">
            <button disabled={offset === 0} onClick={() => void applyFilter(Math.max(0, offset - limit))}>Назад</button>
            <span>{visibleOrders.length ? `${offset + 1}–${offset + visibleOrders.length}` : "0"}</span>
            <button disabled={!page.has_more} onClick={() => void applyFilter(offset + limit)}>Дальше</button>
          </div>
        )}
      </div>

      <OrderDetailPanel
        order={selectedOrder}
        loading={detailLoading}
        actionMenuOpen={Boolean(selectedOrder && actionMenuID === selectedOrder.id)}
        onClose={() => {
          setSelectedID("");
          setDetail(null);
          setActionMenuID("");
        }}
        onToggleActions={(order) => setActionMenuID((current) => current === order.id ? "" : order.id)}
        onCancel={(order) => openReasonDialog({
          title: `Отменить заказ #${order.public_number}`,
          label: "Причина отмены",
          confirmLabel: "Отменить",
          variant: "danger",
          onSubmit: (reason) => executeOrderAction((authToken) => api.cancelOrder(authToken, order.id, reason)).then(() => undefined),
        })}
        onReturn={(order) => openReasonDialog({
          title: `Вернуть заказ #${order.public_number} на кухню`,
          label: "Почему возвращаем",
          confirmLabel: "Вернуть",
          onSubmit: (reason) => executeOrderAction((authToken) => api.returnOrderToNew(authToken, order.id, reason)).then(() => undefined),
        })}
        onEditContact={openContactDialog}
        onNote={(order) => openReasonDialog({
          title: `Заметка к заказу #${order.public_number}`,
          label: "Текст заметки",
          confirmLabel: "Сохранить",
          onSubmit: (reason) => executeOrderAction((authToken) => api.addOrderNote(authToken, order.id, reason)).then(() => undefined),
        })}
        onResendClient={(order) => openReasonDialog({
          title: `Повторить сообщение клиенту #${order.public_number}`,
          label: "Причина повторной отправки",
          confirmLabel: "Отправить",
          onSubmit: (reason) => executeOrderAction((authToken) => api.resendOrder(authToken, order.id, "client", reason)).then(() => undefined),
        })}
        onResendCourier={(order) => openReasonDialog({
          title: `Повторить сообщение курьеру #${order.public_number}`,
          label: "Причина повторной отправки",
          confirmLabel: "Отправить",
          onSubmit: (reason) => executeOrderAction((authToken) => api.resendOrder(authToken, order.id, "courier", reason)).then(() => undefined),
        })}
      />

      {dialog && <OrderActionDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function OrderRow({ order, selected, onSelect }: { order: OrderSummary; selected: boolean; onSelect(): void }) {
  return (
    <button className={`order-row ${selected ? "is-selected" : ""} ${order.fulfillment_status === "NEW" ? "is-new" : ""}`} type="button" onClick={onSelect}>
      <span className="order-avatar" aria-hidden="true">
        {order.client_photo_url ? <img src={order.client_photo_url} alt="" /> : orderAvatarLetters(order)}
      </span>
      <span className="order-row-main">
        <span className="order-row-title">
          <strong>#{order.public_number}</strong>
          <span>{createdText(order.created_at)}</span>
        </span>
        <OrderSummaryClientLink order={order} />
        <span className="order-row-items">{fulfillmentText(order)}{order.fulfillment_type === "pickup" && order.pickup_at ? ` ${pickupDateTime(order.pickup_at)}` : ""} · {adminPaymentText(order)}</span>
      </span>
      <span className="order-row-side">
        <StatusBadge order={order} />
        <strong>{money(order.total_minor)}</strong>
      </span>
    </button>
  );
}

function OrderDetailPanel({
  order,
  loading,
  actionMenuOpen,
  onClose,
  onToggleActions,
  onCancel,
  onReturn,
  onEditContact,
  onNote,
  onResendClient,
  onResendCourier,
}: {
  order: Order | null;
  loading: boolean;
  actionMenuOpen: boolean;
  onClose(): void;
  onToggleActions(order: Order): void;
  onCancel(order: Order): void;
  onReturn(order: Order): void;
  onEditContact(order: Order): void;
  onNote(order: Order): void;
  onResendClient(order: Order): void;
  onResendCourier(order: Order): void;
}) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEventsOpen(false);
    setCopied(false);
  }, [order?.id]);

  if (!order) {
    return (
      <aside className="order-detail empty-detail">
        <ClipboardList size={32} />
        <strong>{loading ? "Загружаем заказ" : "Выберите заказ"}</strong>
        <span>{loading ? "Контакты, состав и события загружаются отдельным запросом." : "Детали и действия откроются здесь."}</span>
      </aside>
    );
  }

  async function copyAddress() {
    if (!order?.address) return;
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(order.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  const canCancel = order.fulfillment_status !== "CANCELLED" && order.fulfillment_status !== "DELIVERED";
  const canReturn = order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP";
  const deliveryOrder = order.fulfillment_type !== "pickup";

  return (
    <aside className="order-detail">
      <div className="order-detail-head">
        <button className="detail-back" type="button" onClick={onClose} aria-label="К списку заказов">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>Заказ #{order.public_number}</h2>
          <span>{createdText(order.created_at)}</span>
        </div>
        <div className="order-detail-actions">
          <StatusBadge order={order} />
          <button type="button" onClick={() => onToggleActions(order)} aria-label="Действия с заказом"><MoreHorizontal size={18} /></button>
          {actionMenuOpen && (
            <div className="order-action-menu">
              {canCancel && <button type="button" onClick={() => onCancel(order)}><Ban size={16} /> Отменить</button>}
              {canReturn && <button type="button" onClick={() => onReturn(order)}><RotateCcw size={16} /> На кухню</button>}
              <button type="button" onClick={() => onEditContact(order)}><Phone size={16} /> Контакт</button>
              <button type="button" onClick={() => onNote(order)}><StickyNote size={16} /> Заметка</button>
              <button type="button" onClick={() => onResendClient(order)}><MessageCircle size={16} /> Клиенту</button>
              {canReturn && deliveryOrder && <button type="button" onClick={() => onResendCourier(order)}><Send size={16} /> Курьеру</button>}
            </div>
          )}
        </div>
      </div>

      <div className="detail-money-grid">
        <div><span>Блюда</span><strong>{money(order.subtotal_minor)}</strong></div>
        <div><span>Доставка</span><strong>{order.delivery_fee_minor ? money(order.delivery_fee_minor) : "Бесплатно"}</strong></div>
        <div className="is-total"><span>Итого</span><strong>{money(order.total_minor)}</strong></div>
      </div>

      <div className="detail-section">
        <h3>Клиент</h3>
        <div className="detail-row">
          <span>Telegram</span>
          <strong><OrderClientLink order={order} /></strong>
        </div>
        {order.client_first_name && (
          <div className="detail-row">
            <span>Имя</span>
            <strong>{order.client_first_name}</strong>
          </div>
        )}
        <div className="detail-row">
          <span>Телефон</span>
          <strong>{order.phone ? <a className="telegram-link" href={`tel:${order.phone}`}>{order.phone}</a> : "не указан"}</strong>
        </div>
        <div className="detail-row">
          <span>Способ оплаты</span>
          <strong>{adminPaymentMethodText(order.payment_method, order.fulfillment_type)}</strong>
        </div>
        <div className="detail-row">
          <span>Статус оплаты</span>
          <strong>{adminPaymentStatusText(order.payment_status)}</strong>
        </div>
        <div className="detail-row">
          <span>Получение</span>
          <strong>{fulfillmentText(order)}</strong>
        </div>
        {!deliveryOrder && order.pickup_at && (
          <div className="detail-row">
            <span>Заберут</span>
            <strong>{pickupDateTime(order.pickup_at)}</strong>
          </div>
        )}
        {order.payment_method === "cash" && (
          <>
            <div className="detail-row">
              <span>Геолокация</span>
              <strong>{order.cash_location_verified_at ? `проверена${typeof order.cash_location_distance_meters === "number" ? ` · ${formatMeters(order.cash_location_distance_meters)}` : ""}` : "не проверена"}</strong>
            </div>
            {order.cash_location_verified_at && (
              <div className="detail-row">
                <span>Проверена в</span>
                <strong>{orderDateTime(order.cash_location_verified_at)}</strong>
              </div>
            )}
          </>
        )}
      </div>

      <div className="detail-section">
        <h3>{deliveryOrder ? "Адрес доставки" : "Самовывоз"}</h3>
        <div className="address-card">
          <span>{deliveryOrder ? order.address || "не указан" : order.pickup_address || "адрес не указан"}</span>
          {deliveryOrder && order.address && <button type="button" onClick={() => void copyAddress()}><Copy size={16} /> {copied ? "Скопировано" : "Копировать"}</button>}
        </div>
        {!deliveryOrder && order.pickup_instructions && <p className="muted">{order.pickup_instructions}</p>}
      </div>

      {order.customer_comment && (
        <div className="order-customer-comment">
          <span><AlertTriangle size={16} /> Комментарий клиента</span>
          <strong>{order.customer_comment}</strong>
        </div>
      )}

      <div className="detail-section">
        <h3>Состав</h3>
        <ul className="order-items-list">
          {order.items.map((item, index) => (
            <li key={`${item.menu_item_id}-${index}`}>
              <span>
                <strong>{item.quantity} × {item.snapshot_title}</strong>
                <small>{money(item.unit_price_minor)} за штуку{item.addition_id ? ` · дозаказ №${item.addition_revision || 1}` : ""}</small>
              </span>
              <strong>{money(item.line_total_minor)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className="detail-section">
        <h3>Время заказа</h3>
        <OrderTimeRow label="Создан" value={order.created_at} />
        <OrderTimeRow label="Начали готовить" value={order.kitchen_started_at} />
        {!deliveryOrder && <OrderTimeRow label="Готовить к" value={order.pickup_cook_at} />}
        {!deliveryOrder && <OrderTimeRow label="Клиент заберёт" value={order.pickup_at} />}
        <OrderTimeRow label={deliveryOrder ? "Передан курьеру" : "Готов к самовывозу"} value={order.ready_at} />
        {deliveryOrder && <OrderTimeRow label="Курьер начал доставку" value={order.courier_started_at} />}
        <OrderTimeRow label={deliveryOrder ? "Доставлен" : "Выдан"} value={order.delivered_at} />
        <OrderTimeRow label="Отменён" value={order.cancelled_at} />
      </div>

      <button className="events-toggle" type="button" onClick={() => setEventsOpen((value) => !value)}>
        {eventsOpen ? "Скрыть историю" : "Показать историю"}
      </button>
      {eventsOpen && (
        <div className="order-events">
          {loading && <p className="muted">Загружаем события…</p>}
          {!loading && !order.events?.length && <p className="muted">Событий пока нет</p>}
          {!loading && order.events?.map((event) => (
            <div className="event-line" key={event.id}>
              <span>{createdText(event.created_at)}</span>
              <strong>{orderEventText(event.action)}</strong>
              <small>{orderEventStatusText(event.from_status, event.to_status)}</small>
              {event.reason && <p>{event.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function OrderActionDialog({ dialog, onClose }: { dialog: OrderDialogState; onClose(): void }) {
  if (dialog.kind === "contact") return <OrderContactDialog dialog={dialog} onClose={onClose} />;
  return <OrderReasonDialog dialog={dialog} onClose={onClose} />;
}

function OrderTimeRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{orderDateTime(value)}</strong>
    </div>
  );
}

function OrderReasonDialog({ dialog, onClose }: { dialog: Extract<OrderDialogState, { kind: "reason" }>; onClose(): void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = reason.trim();
    if (!value) return;
    setSaving(true);
    try {
      await dialog.onSubmit(value);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog order-dialog" onSubmit={(event) => void submit(event)}>
        <h2>{dialog.title}</h2>
        <label>
          <span>{dialog.label}</span>
          <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button className={dialog.variant === "danger" ? "danger-button" : "primary"} type="submit" disabled={saving || !reason.trim()}>
            {saving ? "Сохраняем…" : dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function OrderContactDialog({ dialog, onClose }: { dialog: Extract<OrderDialogState, { kind: "contact" }>; onClose(): void }) {
  const [phone, setPhone] = useState(dialog.order.phone || "");
  const [address, setAddress] = useState(dialog.order.address || "");
  const [reason, setReason] = useState("исправление контакта");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { phone: phone.trim(), address: address.trim(), reason: reason.trim() };
    if (!input.phone || !input.address || !input.reason) return;
    setSaving(true);
    try {
      await dialog.onSubmit(input);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog order-dialog" onSubmit={(event) => void submit(event)}>
        <h2>Контакт заказа #{dialog.order.public_number}</h2>
        <Text label="Телефон" value={phone} onChange={setPhone} />
        <Textarea label="Адрес" value={address} onChange={setAddress} />
        <Text label="Причина" value={reason} onChange={setReason} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button className="primary" type="submit" disabled={saving || !phone.trim() || !address.trim() || !reason.trim()}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScheduleTab({
  schedule,
  runtime,
  manualDayOff,
  onSave,
}: {
  schedule: ScheduleDay[];
  runtime: AdminDashboard["runtime"];
  manualDayOff: boolean;
  onSave(schedule: ScheduleDay[]): Promise<ScheduleDay[]>;
}) {
  const [draft, setDraft] = useState(schedule);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(schedule);
    setSaved(false);
  }, [schedule]);

  const today = belgradeWeekday(runtime.server_time);
  const scheduleOpen = isScheduleOpenNow(draft, runtime.server_time);
  const validationError = scheduleValidationError(draft);
  const dirty = scheduleFingerprint(draft) !== scheduleFingerprint(schedule);

  function patchDay(index: number, patch: Partial<ScheduleDay>) {
    setSaved(false);
    setDraft((current) => replace(current, index, { ...current[index], ...patch }));
  }

  async function patchDayAndSave(index: number, patch: Partial<ScheduleDay>) {
    const next = replace(draft, index, { ...draft[index], ...patch });
    const previous = draft;
    setDraft(next);
    setSaved(false);
    setSaving(true);
    try {
      const authoritative = await onSave(next);
      setDraft(authoritative);
      setSaved(true);
    } catch {
      setDraft(previous);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (validationError || !dirty) return;
    setSaving(true);
    try {
      const authoritative = await onSave(draft);
      setDraft(authoritative);
      setSaved(true);
    } catch {
      // The global error panel contains the server error; keep the edited draft for correction/retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <div className={`panel schedule-live-status ${runtime.accepting_orders ? "is-open" : "is-blocked"}`}>
        <div className="schedule-live-copy">
          <span className="eyebrow">Сейчас · Нови-Сад</span>
          <h2>{runtime.accepting_orders ? "Заказы принимаются" : "Заказы не принимаются"}</h2>
          <p>{scheduleRuntimeExplanation(runtime.reason, manualDayOff, scheduleOpen)}</p>
        </div>
        <div className="schedule-live-facts">
          <span>По графику</span>
          <strong>{scheduleOpen ? "открыто" : "закрыто"}</strong>
        </div>
      </div>

      {runtime.reason === "fiscal_process_pending" && (
        <div className="schedule-blocker" role="status">
          <AlertTriangle size={20} />
          <div>
            <strong>График работает, но есть отдельная блокировка</strong>
            <p>Сервер не разрешит реальные заказы, пока в конфигурации не подтверждён фискальный процесс. Изменение часов эту защиту не отключает.</p>
          </div>
        </div>
      )}

      <div className="schedule-heading">
        <div>
          <h2>Неделя</h2>
          <p className="muted">Открытие — начало заказов. «Заказы до» — конец приёма. Закрытие — конец работы кухни.</p>
        </div>
        {dirty && <span className="unsaved-badge">Есть изменения</span>}
      </div>

      <div className="schedule-grid">
        {draft.map((day, index) => (
          <article className={`${day.closed ? "schedule-card is-closed" : "schedule-card"}${today === day.day_of_week ? " is-today" : ""}`} key={day.day_of_week}>
            <div className="schedule-card-head">
              <div>
                <div className="schedule-day-title">
                  <strong>{weekdayLong(day.day_of_week)}</strong>
                  {today === day.day_of_week && <span>Сегодня</span>}
                </div>
                <span>{day.closed ? "Выходной" : `${day.open_time}–${day.close_time}, заказы до ${day.order_cutoff_time}`}</span>
              </div>
              <button
                className={`schedule-day-toggle${day.closed ? " is-off" : " is-on"}`}
                disabled={saving}
                aria-pressed={!day.closed}
                onClick={() => void patchDayAndSave(index, { closed: !day.closed, ...(!day.closed ? {} : quickSchedule) })}
              >
                {day.closed ? "Выходной" : "Рабочий"}
              </button>
            </div>
            {!day.closed && (
              <div className="schedule-time-row">
                <label><span>Открытие</span><input type="time" value={day.open_time} onChange={(event) => patchDay(index, { open_time: event.target.value })} /></label>
                <label><span>Заказы до</span><input type="time" value={day.order_cutoff_time} onChange={(event) => patchDay(index, { order_cutoff_time: event.target.value })} /></label>
                <label><span>Закрытие</span><input type="time" value={day.close_time} onChange={(event) => patchDay(index, { close_time: event.target.value })} /></label>
                <button className="schedule-template" disabled={saving} onClick={() => void patchDayAndSave(index, quickSchedule)}>13–21–22</button>
              </div>
            )}
          </article>
        ))}
      </div>

      {validationError && <div className="schedule-validation"><AlertTriangle size={18} /> {validationError}</div>}
      <div className="schedule-savebar">
        <span>{saved && !dirty ? "График сохранён" : dirty ? "Сохраните изменённое время" : "Все изменения сохранены"}</span>
        <button className="primary" disabled={saving || !dirty || Boolean(validationError)} onClick={() => void saveDraft()}>
          <Save size={16} /> {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}

function SettingsTab({ settings, demoMode, onSave }: { settings: Settings; demoMode: boolean; onSave(input: SettingsInput): Promise<void> }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  return (
    <section className="settings-workspace">
      <div className="panel settings-card">
        <h2>Заказы</h2>
        <div className="form-grid">
          <NumberInput label="Максимум блюда" value={form.max_item_quantity} onChange={(max_item_quantity) => setForm({ ...form, max_item_quantity })} />
          <NumberInput label="Комментарий" value={form.max_comment_length} onChange={(max_comment_length) => setForm({ ...form, max_comment_length })} />
        </div>
      </div>

      <div className="panel settings-card">
        <div className="settings-card-head">
          <h2>Поддержка</h2>
          <p>Эти контакты видит клиент в разделе “Поддержка” и в юридических страницах.</p>
        </div>
        <div className="support-settings">
          <label>
            <span>Telegram поддержки</span>
            <input value={form.support_text} placeholder="@Tako_Lako" onChange={(event) => setForm({ ...form, support_text: event.target.value })} />
            <small>Основной канал: клиент нажимает кнопку и сразу пишет сюда.</small>
          </label>
          <label>
            <span>Телефон поддержки</span>
            <input value={form.support_phone} placeholder="+381 ..." onChange={(event) => setForm({ ...form, support_phone: event.target.value })} />
            <small>Можно оставить пустым, если сейчас работает только Telegram.</small>
          </label>
          <label>
            <span>Ссылка на условия</span>
            <input value={form.terms_url} placeholder="Оставь пустым — откроется встроенная страница" onChange={(event) => setForm({ ...form, terms_url: event.target.value })} />
            <small>Нужна только если условия будут на внешнем сайте.</small>
          </label>
        </div>
        <div className="support-preview">
          <span>Как это выглядит клиенту</span>
          <strong>{form.support_text.trim() || "@Tako_Lako"}</strong>
          {form.support_phone.trim() && <small>{form.support_phone.trim()}</small>}
        </div>
      </div>

      <div className="panel settings-card">
        <h2>Наличные</h2>
        <label className="check"><input type="checkbox" checked={form.cash_enabled} onChange={(event) => setForm({ ...form, cash_enabled: event.target.checked })} /> Принимать наличные</label>
        <label className="check"><input type="checkbox" checked={form.cash_location_required} onChange={(event) => setForm({ ...form, cash_location_required: event.target.checked })} /> Проверять геопозицию</label>
      </div>

      <div className="panel settings-card pickup-settings-card">
        <div className="settings-card-head">
          <h2>Самовывоз</h2>
          <p>Клиент выбирает свободное время. Кухня видит заказ заранее и готовит его к выбранному часу.</p>
        </div>
        <label className="check"><input type="checkbox" checked={form.pickup_enabled} onChange={(event) => setForm({ ...form, pickup_enabled: event.target.checked })} /> Принимать заказы на самовывоз</label>
        <div className="form-grid three">
          <NumberInput label="Готовить за, мин" value={form.pickup_min_lead_minutes} onChange={(pickup_min_lead_minutes) => setForm({ ...form, pickup_min_lead_minutes })} />
          <NumberInput label="Шаг времени, мин" value={form.pickup_slot_minutes} onChange={(pickup_slot_minutes) => setForm({ ...form, pickup_slot_minutes })} />
          <NumberInput label="Заказов на время" value={form.pickup_max_orders_per_slot} onChange={(pickup_max_orders_per_slot) => setForm({ ...form, pickup_max_orders_per_slot })} />
        </div>
        <label><span>Последний самовывоз</span><input type="time" value={form.pickup_last_time} onChange={(event) => setForm({ ...form, pickup_last_time: event.target.value })} /></label>
        <Text label="Адрес самовывоза" value={form.pickup_address} onChange={(pickup_address) => setForm({ ...form, pickup_address })} />
        <Text label="Ссылка на карту" value={form.pickup_map_url} onChange={(pickup_map_url) => setForm({ ...form, pickup_map_url })} />
        <details className="pickup-copy-settings">
          <summary>Инструкция для клиента</summary>
          <div className="stack compact-stack">
            <Textarea label="Русский" value={form.pickup_instructions_ru} onChange={(pickup_instructions_ru) => setForm({ ...form, pickup_instructions_ru })} />
            <Textarea label="Сербский" value={form.pickup_instructions_sr} onChange={(pickup_instructions_sr) => setForm({ ...form, pickup_instructions_sr })} />
            <Textarea label="Английский" value={form.pickup_instructions_en} onChange={(pickup_instructions_en) => setForm({ ...form, pickup_instructions_en })} />
          </div>
        </details>
      </div>

      <div className="panel settings-card">
        <h2>Способы оплаты</h2>
        <label className="check disabled-check"><input type="checkbox" checked={false} disabled /> Карта — этап 5</label>
        <label className={demoMode ? "check" : "check disabled-check"}>
          <input
            type="checkbox"
            checked={Boolean(form.crypto_enabled)}
            disabled={!demoMode}
            onChange={(event) => setForm({ ...form, crypto_enabled: event.target.checked })}
          />
          Crypto demo
        </label>
      </div>

      <details className="panel advanced-fields settings-card">
        <summary>Расширенные</summary>
        <div className="advanced-fields-body">
          <div className="form-grid three">
            <NumberInput label="Широта" value={form.restaurant_latitude} onChange={(restaurant_latitude) => setForm({ ...form, restaurant_latitude })} />
            <NumberInput label="Долгота" value={form.restaurant_longitude} onChange={(restaurant_longitude) => setForm({ ...form, restaurant_longitude })} />
            <NumberInput label="Радиус проверки" value={form.cash_location_radius_meters} onChange={(cash_location_radius_meters) => setForm({ ...form, cash_location_radius_meters })} />
            <NumberInput label="Срок подтверждения" value={form.cash_location_ttl_seconds} onChange={(cash_location_ttl_seconds) => setForm({ ...form, cash_location_ttl_seconds })} />
            <NumberInput label="Погрешность" value={form.cash_location_max_accuracy_meters} onChange={(cash_location_max_accuracy_meters) => setForm({ ...form, cash_location_max_accuracy_meters })} />
          </div>
        </div>
      </details>

      <button className="primary sticky-save" onClick={() => void onSave({ ...form, flat_delivery_fee_minor: 0, card_enabled: false, crypto_enabled: demoMode ? form.crypto_enabled : false })}>
        <Save size={16} /> Сохранить настройки
      </button>
    </section>
  );
}

function AnalyticsTab({ analytics, range, onRange, onExport }: { analytics: AdminAnalytics; range: AnalyticsRange; onRange(range: AnalyticsRange): void; onExport(): void }) {
  const labels: Record<AnalyticsRange, string> = { today: "Сегодня", "7d": "7 дней", month: "Месяц" };
  const topDishes = analytics.top_dishes ?? [];
  const dailyRows = analytics.daily_rows ?? [];
  const paymentRows = paymentBreakdownRows(analytics.payments ?? []);
  return (
    <section className="stack">
      <div className="toolbar panel">
        {(["today", "7d", "month"] as AnalyticsRange[]).map((entry) => <button key={entry} className={range === entry ? "primary" : ""} onClick={() => onRange(entry)}>{labels[entry]}</button>)}
        <button onClick={onExport}>CSV export</button>
      </div>
      <div className="grid">
        <Metric title="Всего заказов" value={analytics.summary.all_orders} />
        <Metric title="Доставлены" value={analytics.summary.delivered_orders} />
        <Metric title="Отменены" value={analytics.summary.cancelled_orders} />
        <Metric title="Выручка" value={money(analytics.summary.revenue_minor)} />
        <Metric title="Средний чек" value={money(analytics.summary.average_check_minor)} />
      </div>
      <section className="panel analytics-payments">
        <div>
          <h2>Оплата</h2>
          <p className="muted">Разделение по способу оплаты: сколько заказов пришло, сколько доставлено, сколько оплачено и какая выручка закрыта.</p>
        </div>
        <div className="payment-breakdown">
          {paymentRows.map((row) => (
            <article className={`payment-card payment-kind-${row.key}`} key={row.key}>
              <div className="payment-card-head">
                <span>{paymentMethodLabel(row.key)}</span>
                <strong>{money(row.revenue_minor)}</strong>
              </div>
              <div className="payment-card-grid">
                <span>Всего <b>{row.count}</b></span>
                <span>Доставлено <b>{row.delivered_count}</b></span>
                <span>Оплачено <b>{row.paid_count}</b></span>
                <span>Отменено <b>{row.cancelled_count}</b></span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="two">
        <SimpleTable title="Популярные блюда" rows={topDishes.map((dish) => [dish.title, `${dish.quantity} шт`, money(dish.revenue_minor)])} />
        <SimpleTable title="По дням" rows={dailyRows.map((row) => [row.day, `${row.orders} заказов`, money(row.revenue_minor)])} />
      </div>
    </section>
  );
}

function paymentBreakdownRows(rows: AnalyticsBreakdown[]): AnalyticsBreakdown[] {
  const empty = (key: string): AnalyticsBreakdown => ({ key, count: 0, delivered_count: 0, paid_count: 0, cancelled_count: 0, revenue_minor: 0 });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const orderedKeys = ["cash", "card", ...rows.map((row) => row.key).filter((key) => key !== "cash" && key !== "card")];
  return [...new Set(orderedKeys)].map((key) => ({ ...empty(key), ...(byKey.get(key) || {}) }));
}

function paymentMethodLabel(method: string): string {
  if (method === "cash") return "Наличные";
  if (method === "card") return "Карта";
  if (method === "crypto") return "Crypto";
  return method;
}

function AuditTab({
  entries,
  page,
  onPageChange,
}: {
  entries: AuditEntry[];
  page: Pick<AuditLogResponse, "limit" | "offset" | "has_more">;
  onPageChange(offset: number): Promise<void>;
}) {
  const limit = page.limit || 50;
  const offset = page.offset || 0;
  return (
    <section className="panel">
      {entries.length === 0 ? <p className="muted">Журнал пуст</p> : entries.map((entry) => (
        <div className="audit" key={entry.id}>
          <strong>{auditActionText(entry.action)}</strong>
          <span>{new Date(entry.created_at).toLocaleString("ru-RU")}</span>
          {entry.reason && <p>{entry.reason}</p>}
        </div>
      ))}
      {(offset > 0 || page.has_more) && (
        <div className="orders-pagination audit-pagination">
          <button disabled={offset === 0} onClick={() => void onPageChange(Math.max(0, offset - limit))}>Назад</button>
          <span>{entries.length ? `${offset + 1}–${offset + entries.length}` : "0"}</span>
          <button disabled={!page.has_more} onClick={() => void onPageChange(offset + limit)}>Дальше</button>
        </div>
      )}
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return <div className="metric"><span>{title}</span><strong>{value}</strong></div>;
}

function StatusPills({ visible, archived }: { visible: boolean; archived: boolean }) {
  return <span className={archived ? "pill archived" : visible ? "pill visible" : "pill hidden"}>{archived ? "В архиве" : visible ? "Видно" : "Скрыто"}</span>;
}

function adminOrderStatusText(order: Order | OrderSummary): string {
  if (order.fulfillment_type === "pickup") {
    if (order.fulfillment_status === "NEW") return "Новый · самовывоз";
    if (order.fulfillment_status === "READY_FOR_PICKUP") return "Готов к самовывозу";
    if (order.fulfillment_status === "DELIVERED") return "Выдан";
  }
  return statusText(order.fulfillment_status);
}

function fulfillmentText(order: Order | OrderSummary): string {
  return order.fulfillment_type === "pickup" ? "Самовывоз" : "Доставка";
}

function pickupDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(value));
}

function StatusBadge({ order }: { order: Order | OrderSummary }) {
  return <span className={`status-badge status-${order.fulfillment_status.toLowerCase()} fulfillment-${order.fulfillment_type}`}>{adminOrderStatusText(order)}</span>;
}

function SimpleTable({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2>{rows.length ? rows.map((row) => <div className="row compact" key={row.join(":")}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>) : <p className="muted">Нет данных</p>}</div>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function navItems(ids: AdminTab[]): AdminNavItem[] {
  return ids.map((id) => navItem(id));
}

function navItem(id: AdminTab): AdminNavItem {
  return tabs.find((entry) => entry.id === id) || tabs[0];
}

function initialAdminTab(): AdminTab {
  return tabFromHash();
}

function tabFromHash(): AdminTab {
  const value = window.location.hash.replace(/^#\/?/, "");
  return isAdminTab(value) ? value : "home";
}

function isAdminTab(value: string): value is AdminTab {
  return tabs.some((entry) => entry.id === value);
}

function updateAdminHash(tab: AdminTab): void {
  const hash = tab === "home" ? "" : `#${tab}`;
  const nextURL = `${window.location.pathname}${window.location.search}${hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextURL) {
    window.history.pushState(null, "", nextURL);
  }
}

function emptyCategory(): AdminCategory {
  const now = new Date().toISOString();
  return { id: "", title_ru: "", title_sr: "", title_en: "", sort_order: 100, visible: true, archived: false, item_count: 0, version: 1, created_at: now, updated_at: now };
}

function emptyItem(categoryID: string): AdminMenuItem {
  const now = new Date().toISOString();
  return {
    id: "",
    category_id: categoryID,
    title_ru: "",
    title_sr: "",
    title_en: "",
    description_ru: "",
    description_sr: "",
    description_en: "",
    price_minor: 0,
    currency: "RSD",
    photo_path: "",
    weight_text: "",
    min_quantity: 1,
    allergen_text_ru: "",
    allergen_text_sr: "",
    allergen_text_en: "",
    sort_order: 100,
    visible: true,
    archived: false,
    used_in_orders: false,
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function categoryInputFromForm(form: AdminCategory): CategoryInput {
  const titleRU = form.title_ru.trim();
  return {
    title_ru: titleRU,
    title_sr: form.title_sr.trim() || titleRU,
    title_en: form.title_en.trim() || titleRU,
    sort_order: Math.round(form.sort_order || 100),
    visible: form.visible,
    version: form.version,
  };
}

function dishInputFromForm(form: AdminMenuItem): MenuItemInput {
  const titleRU = form.title_ru.trim();
  const descriptionRU = form.description_ru.trim();
  const allergenRU = form.allergen_text_ru.trim();
  return {
    category_id: form.category_id,
    title_ru: titleRU,
    title_sr: form.title_sr.trim() || titleRU,
    title_en: form.title_en.trim() || titleRU,
    description_ru: descriptionRU,
    description_sr: form.description_sr.trim() || descriptionRU,
    description_en: form.description_en.trim() || descriptionRU,
    price_minor: Math.max(0, Math.round(form.price_minor || 0)),
    photo_path: form.photo_path.trim(),
    weight_text: form.weight_text.trim(),
    min_quantity: Math.max(1, Math.round(form.min_quantity || 1)),
    allergen_text_ru: allergenRU,
    allergen_text_sr: form.allergen_text_sr.trim() || allergenRU,
    allergen_text_en: form.allergen_text_en.trim() || allergenRU,
    sort_order: Math.round(form.sort_order || 100),
    visible: form.visible,
    version: form.version,
  };
}

function categoryTitle(categories: AdminCategory[], id: string): string {
  return categories.find((category) => category.id === id)?.title_ru || "без категории";
}

function weekdayShort(day: number): string {
  return ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][day] || String(day);
}

function weekdayLong(day: number): string {
  return ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][day] || String(day);
}

function belgradeClock(serverTime: string): { weekday: number; minutes: number } {
  const value = new Date(serverTime);
  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Belgrade",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(safeValue);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { weekday: Math.max(0, weekday), minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

function belgradeWeekday(serverTime: string): number {
  return belgradeClock(serverTime).weekday;
}

function timeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isScheduleOpenNow(schedule: ScheduleDay[], serverTime: string): boolean {
  const clock = belgradeClock(serverTime);
  const day = schedule.find((entry) => entry.day_of_week === clock.weekday);
  if (!day || day.closed) return false;
  const open = timeMinutes(day.open_time);
  const cutoff = timeMinutes(day.order_cutoff_time);
  return open !== null && cutoff !== null && clock.minutes >= open && clock.minutes < cutoff;
}

function scheduleValidationError(schedule: ScheduleDay[]): string {
  for (const day of schedule) {
    const open = timeMinutes(day.open_time);
    const cutoff = timeMinutes(day.order_cutoff_time);
    const close = timeMinutes(day.close_time);
    if (open === null || cutoff === null || close === null) return `${weekdayLong(day.day_of_week)}: заполните все три времени.`;
    if (!(open < cutoff && cutoff <= close)) {
      return `${weekdayLong(day.day_of_week)}: открытие должно быть раньше конца приёма, а конец приёма — не позже закрытия.`;
    }
  }
  return "";
}

function scheduleFingerprint(schedule: ScheduleDay[]): string {
  return JSON.stringify(schedule.map((day) => [day.day_of_week, day.closed, day.open_time, day.order_cutoff_time, day.close_time]));
}

function scheduleRuntimeExplanation(reason: string, manualDayOff: boolean, scheduleOpen: boolean): string {
  if (reason === "fiscal_process_pending") return "Часы сохранены, но приём остановлен отдельной серверной защитой.";
  if (manualDayOff || reason === "manual_day_off") return "Включён ручной режим «Выходной» на главной странице.";
  if (reason === "weekly_day_off") return "Сегодня отмечено как выходной.";
  if (reason === "schedule_closed") return scheduleOpen ? "Статус обновляется — по сохранённым часам уже можно принимать заказы." : "Сейчас ещё рано или приём заказов уже завершён.";
  return scheduleOpen ? "Текущее время входит в период приёма заказов." : "Сейчас время вне периода приёма заказов.";
}

function replace<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, current) => current === index ? value : item);
}

function orderPageMeta(page: AdminOrdersResponse): AdminOrdersPageState {
  return {
    limit: page.limit || 20,
    offset: page.offset || 0,
    has_more: Boolean(page.has_more),
    counts: page.counts,
  };
}

function normalizeOrderLoadFilter(filter: OrderLoadFilter, page?: Pick<AdminOrdersResponse, "limit" | "offset">): OrderLoadFilter {
  const rawLimit = typeof filter.limit === "number" && Number.isFinite(filter.limit) ? filter.limit : page?.limit;
  const rawOffset = typeof filter.offset === "number" && Number.isFinite(filter.offset) ? filter.offset : page?.offset;
  return {
    status: filter.status || "ACTIVE",
    q: filter.q?.trim() || undefined,
    date: filter.date || undefined,
    limit: Math.min(Math.max(Math.trunc(rawLimit || 20), 1), 50),
    offset: Math.max(Math.trunc(rawOffset ?? 0), 0),
  };
}

function auditPageMeta(page: AuditLogResponse): Pick<AuditLogResponse, "limit" | "offset" | "has_more"> {
  return {
    limit: page.limit || 50,
    offset: page.offset || 0,
    has_more: Boolean(page.has_more),
  };
}

function bootstrapOptions(tab: AdminTab, range: AnalyticsRange) {
  return {
    range,
    status: tab === "orders" ? "ACTIVE" : undefined,
    limit: tab === "audit" ? 50 : 20,
    offset: 0,
  };
}

function ordersLoadFilter(view: OrdersView, query: string, date: string, limit: number, offset: number): OrderLoadFilter {
  return {
    status: orderViewStatus(view),
    q: query.trim() || undefined,
    date: date || undefined,
    limit,
    offset,
  };
}

function orderViewStatus(view: OrdersView): string {
  if (view === "active") return "ACTIVE";
  if (view === "new") return "NEW";
  if (view === "ready") return "READY";
  return "HISTORY";
}

function fallbackOrderCounts(orders: OrderSummary[]): AdminOrderCounts {
  return {
    active: orders.filter((order) => orderMatchesView(order, "active")).length,
    new: orders.filter((order) => order.fulfillment_status === "NEW").length,
    ready: orders.filter((order) => order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP").length,
    history: orders.filter((order) => orderMatchesView(order, "history")).length,
  };
}

function orderMatchesView(order: OrderSummary, view: OrdersView): boolean {
  if (view === "active") return order.fulfillment_status === "NEW" || order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP";
  if (view === "new") return order.fulfillment_status === "NEW";
  if (view === "ready") return order.fulfillment_status === "OUT_FOR_DELIVERY" || order.fulfillment_status === "READY_FOR_PICKUP";
  return order.fulfillment_status === "DELIVERED" || order.fulfillment_status === "CANCELLED";
}

function orderSearchMatch(order: OrderSummary, query: string): boolean {
  if (!query) return true;
  return [
    String(order.public_number),
    order.client_username || "",
    order.client_first_name || "",
  ].some((value) => value.toLowerCase().includes(query));
}

function orderDateMatch(order: OrderSummary, date: string): boolean {
  if (!date) return true;
  return order.created_at.slice(0, 10) === date;
}

function isOrderResponse(value: unknown): value is Order {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Order>;
  return typeof candidate.id === "string"
    && typeof candidate.public_number === "number"
    && typeof candidate.fulfillment_status === "string"
    && Array.isArray(candidate.items);
}

function orderItemsSummary(order: Order): string {
  const preview = order.items.slice(0, 2).map((item) => `${item.quantity}× ${item.snapshot_title}`).join(", ");
  if (!preview) return "без блюд";
  return order.items.length > 2 ? `${preview} +${order.items.length - 2}` : preview;
}

function orderAvatarLetters(order: OrderSummary): string {
  const username = telegramUsername(order);
  const name = username || order.client_first_name || "TL";
  return name.slice(0, 2).toUpperCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function orderEventText(action: string): string {
  const map: Record<string, string> = {
    create_order: "Заказ создан",
    create_cash_order: "Заказ создан",
    kitchen_ready: "Кухня нажала «Заказ готов»",
    mark_ready: "Кухня нажала «Заказ готов»",
    courier_delivered: "Курьер доставил",
    mark_delivered: "Курьер доставил",
    mark_pickup_collected: "Самовывоз выдан клиенту",
    admin_cancel: "Админ отменил",
    admin_return_to_new: "Админ вернул на кухню",
    admin_edit_contact: "Админ изменил контакт",
    admin_note: "Заметка админа",
    "order.demo_snapshot": "Demo snapshot",
  };
  return map[action] || auditActionText(action) || action;
}

function orderEventStatusText(from: string, to: string): string {
  const values = [from, to].filter(isOrderStatus).map((value) => statusText(value as Order["fulfillment_status"]));
  return values.join(" → ");
}

function isOrderStatus(value: string): boolean {
  return value === "NEW" || value === "OUT_FOR_DELIVERY" || value === "READY_FOR_PICKUP" || value === "DELIVERED" || value === "CANCELLED";
}

function OrderClientLink({ order }: { order: Order }) {
  const label = orderClientLabel(order);
  const href = telegramUserLink(order);
  if (!href) return <>{label}</>;
  return (
    <a
      className="telegram-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openTelegramLink(href);
      }}
    >
      {label}
    </a>
  );
}

function OrderSummaryClientLink({ order }: { order: OrderSummary }) {
  const label = orderClientLabel(order);
  const href = telegramUserLink(order);
  if (!href) return <span className="order-row-client">{label}</span>;
  return (
    <span
      className="order-row-client telegram-link"
      role="link"
      tabIndex={0}
      title={`Открыть ЛС ${label}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openTelegramLink(href);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        openTelegramLink(href);
      }}
    >
      {label}
    </span>
  );
}

function orderClientLabel(order: OrderSummary): string {
  const username = telegramUsername(order);
  if (username) return `@${username}`;
  return order.client_first_name || "Клиент Telegram";
}

function adminPaymentText(order: OrderSummary): string {
  if (order.payment_method === "crypto") return order.payment_status === "PAID" ? "Crypto TEST · PAID" : "Crypto TEST";
  if (order.payment_method === "card") return order.payment_status === "PAID" ? "Карта · PAID" : "Карта";
  if (order.fulfillment_type === "pickup") return order.payment_status === "PAID" ? "Наличные при самовывозе · PAID" : "Наличные при самовывозе";
  return order.payment_status === "PAID" ? "Наличные · PAID" : "Наличные";
}

function adminPaymentMethodText(method: OrderSummary["payment_method"], fulfillmentType: OrderSummary["fulfillment_type"]): string {
  if (method === "card") return "Банковская карта";
  if (method === "crypto") return "Crypto TEST";
  return fulfillmentType === "pickup" ? "Наличные при самовывозе" : "Наличные курьеру";
}

function adminPaymentStatusText(status: OrderSummary["payment_status"]): string {
  const labels: Record<OrderSummary["payment_status"], string> = {
    CASH_PENDING: "Ожидаются наличные",
    PAID: "Оплачено",
    FAILED: "Не оплачено",
    REFUNDED: "Возвращено",
  };
  return labels[status];
}

function telegramUsername(order: OrderSummary): string {
  const username = (order.client_username || "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
}

function telegramUserLink(order: OrderSummary, draftText = ""): string | undefined {
  const username = telegramUsername(order);
  if (!username) return undefined;
  const query = draftText ? `?text=${encodeURIComponent(draftText)}` : "";
  return `https://t.me/${username}${query}`;
}

function openTelegramLink(url: string): void {
  const webApp = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (value: string) => void } } }).Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function createdText(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function orderDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(value));
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} км от ресторана`;
  return `${meters} м от ресторана`;
}

function runtimeReason(reason: string): string {
  if (reason === "manual_day_off") return "Включён ручной режим ВЫХОДНОЙ.";
  if (reason === "weekly_day_off") return "Сегодня выходной по недельному графику.";
  if (reason === "schedule_closed") return "Сейчас вне времени приёма заказов.";
  if (reason === "order_cutoff_passed") return "Приём заказов на сегодня завершён.";
  if (reason === "fiscal_process_pending") return "Приём заблокирован: фискальный процесс ещё не подтверждён на сервере.";
  return "Работает по текущему графику.";
}

function compactRuntimeReason(reason: string): string {
  if (reason === "manual_day_off") return "Ручной выходной";
  if (reason === "weekly_day_off") return "Выходной по графику";
  if (reason === "schedule_closed") return "По графику закрыто";
  if (reason === "order_cutoff_passed") return "Заказы на сегодня закрыты";
  if (reason === "fiscal_process_pending") return "Нужно подтвердить фискальный процесс";
  return "Заказы до 21:00";
}

function auditActionText(action: string): string {
  const map: Record<string, string> = {
    "category.create": "Создание категории",
    "category.update": "Изменение категории",
    "category.archive": "Категория отправлена в архив",
    "category.restore": "Категория восстановлена",
    "category.delete": "Категория удалена",
    "menu_item.create": "Создание блюда",
    "menu_item.update": "Изменение блюда",
    "menu_item.price_change": "Изменение цены",
    "menu_item.archive": "Блюдо отправлено в архив",
    "menu_item.restore": "Блюдо восстановлено",
    "menu_item.delete": "Блюдо удалено",
    "order.cancel": "Заказ отменён",
    "order.return_to_new": "Заказ возвращён на кухню",
    "order.edit_contact": "Контакт заказа изменён",
    "order.note": "Заметка к заказу",
    "order.courier_eta": "Курьер сообщил ETA",
    "settings.update": "Настройки изменены",
    "settings.manual_day_off": "Режим ВЫХОДНОЙ изменён",
    "schedule.update": "График изменён",
    "staff.create": "Сотрудник добавлен",
    "staff.update": "Сотрудник изменён",
  };
  return map[action] || action;
}

function errorText(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "ORDER_STATUS_CONFLICT") return "Данные устарели или статус уже изменился. Обнови экран.";
  if (code === "INVALID_INPUT") return "Некорректные данные. Проверь поля и ограничения.";
  if (code === "TELEGRAM_INIT_DATA_MISSING") return "Откройте админку именно через Telegram Mini App. В обычном браузере или внешней вкладке Telegram не передаёт данные входа.";
  if (code === "AUTH_INVALID") return "Telegram-сессия устарела или открыта не через @TakoLako_main_bot. Полностью закройте Mini App и откройте заново из бота.";
  if (code === "FORBIDDEN") return "Нет ADMIN доступа.";
  if (code === "RATE_LIMITED") return "Слишком много запросов. Подождите минуту и попробуйте ещё раз.";
  if (code === "SERVER_UNAVAILABLE" || code === "INTERNAL") return "Сервер недоступен. Попробуйте ещё раз.";
  return "Ошибка запроса. Попробуйте ещё раз.";
}

function adminLoadLabel(key: AdminLoadKey): string {
  const labels: Record<AdminLoadKey, string> = {
    dashboard: "главная",
    menu: "меню",
    settings: "настройки",
    schedule: "график",
    orders: "заказы",
		reservations: "брони",
    analytics: "аналитика",
    audit: "журнал",
  };
  return labels[key];
}

function adminPhotoURL(path: string): string {
  const value = path.trim();
  if (!value) return "";
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith("/media/")) {
    const apiBase = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
    return apiBase ? `${apiBase}${value}` : value;
  }
  if (value.startsWith("/")) return value;
  return `/${value.replace(/^\/+/, "")}`;
}

function adminPhotoPreview(item: AdminMenuItem): { url: string; width?: number; height?: number } {
  const variant = item.photo_variants?.thumbnail?.url
    ? item.photo_variants.thumbnail
    : item.photo_variants?.display?.url
      ? item.photo_variants.display
      : undefined;
  if (!variant) return { url: adminPhotoURL(item.photo_path) };

  return {
    url: adminPhotoURL(variant.url),
    width: positiveDimension(variant.width),
    height: positiveDimension(variant.height),
  };
}

function positiveDimension(value: number): number | undefined {
  return value > 0 ? value : undefined;
}
