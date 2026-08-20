import type { Order, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, isAuthError, kitchenTimeText, money, openTelegramLink, paymentText, problemLink, startVisiblePolling, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, MoreVertical, RefreshCw, WifiOff } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("KITCHEN");
const kitchenSeenOrdersKey = "tk-kitchen-seen-orders-v2";
let notificationAudioContext: AudioContext | null = null;
let pendingNotificationSound = false;
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  resolve(confirmed: boolean): void;
};

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [activeWindow, setActiveWindow] = useState<"delivery" | "pickup">("delivery");
  const [clock, setClock] = useState(() => Date.now());
  const seenIdsRef = useRef(loadSeenOrderIds(kitchenSeenOrdersKey));
  const notifiedIds = useRef(new Set<string>());
  const dueAlertedIds = useRef(new Set<string>());
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(seenIdsRef.current));
  const authRetry = useMemo(() => createSingleFlightAuthRetry({
    authenticate,
    isAuthError,
  }), []);

  const deliveryOrders = useMemo(() => orders.filter((order) => order.fulfillment_type !== "pickup" && order.fulfillment_status === "NEW"), [orders]);
  const pickupOrders = useMemo(() => orders.filter((order) => order.fulfillment_type === "pickup" && order.fulfillment_status === "NEW"), [orders]);
  const pickupReadyOrders = useMemo(() => orders.filter(isPickupReady), [orders]);
  const sortedDeliveryOrders = useMemo(() => [...deliveryOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [deliveryOrders]);
  const sortedPickupOrders = useMemo(() => [...pickupOrders].sort((a, b) => pickupTimestamp(a) - pickupTimestamp(b)), [pickupOrders]);
  const pickupDueOrders = useMemo(() => sortedPickupOrders.filter((order) => pickupCookTimestamp(order) <= clock), [sortedPickupOrders, clock]);
  const pickupLaterOrders = useMemo(() => sortedPickupOrders.filter((order) => pickupCookTimestamp(order) > clock), [sortedPickupOrders, clock]);
  const sortedPickupReadyOrders = useMemo(() => [...pickupReadyOrders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [pickupReadyOrders]);

  useEffect(() => installPerformanceBeacon("kitchen", () => "orders"), []);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const dueNow = pickupDueOrders.filter((order) => !dueAlertedIds.current.has(order.id));
    pickupDueOrders.forEach((order) => dueAlertedIds.current.add(order.id));
    if (dueNow.length) playBeep();
  }, [pickupDueOrders]);

  function markSeen(order: Order) {
    const key = seenKey(order);
    if (seenIdsRef.current.has(key)) return;
    const next = new Set(seenIdsRef.current);
    next.add(key);
    seenIdsRef.current = next;
    setSeenIds(next);
    saveSeenOrderIds(kitchenSeenOrdersKey, next);
  }

  function applySession(session: Awaited<ReturnType<typeof api.authenticate>>) {
    setToken(session.token);
    setTelegramUserId(session.telegram_user_id);
    setOffline(false);
    return session.token;
  }

  async function authenticate() {
    return applySession(await api.authenticate("KITCHEN"));
  }

  async function refreshAuth() {
    return authRetry.refreshAuth();
  }

  async function withAuth<T>(action: (authToken: string) => Promise<T>, authToken = token): Promise<T> {
    return authRetry.withAuth(action, authToken);
  }

  function askConfirm(input: Omit<ConfirmDialogState, "resolve">): Promise<boolean> {
    return new Promise((resolve) => setConfirmDialog({ ...input, resolve }));
  }

  function closeConfirm(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  async function refresh(signal?: AbortSignal, authToken = token) {
    try {
      const response = await withAuth((currentToken) => api.listKitchenOrders(currentToken, signal), authToken);
      const incoming = response.orders.filter((order) => !seenIdsRef.current.has(seenKey(order)) && !notifiedIds.current.has(seenKey(order)));
      response.orders.forEach((order) => notifiedIds.current.add(seenKey(order)));
      incoming.filter((order) => order.fulfillment_type === "pickup" && order.fulfillment_status === "NEW" && pickupCookTimestamp(order) <= Date.now())
        .forEach((order) => dueAlertedIds.current.add(order.id));
      if (incoming.length) playBeep();
      setOrders(response.orders);
      setLastUpdated(new Date());
      setOffline(false);
    } catch {
      if (signal?.aborted) return;
      setOffline(true);
    }
  }

  useEffect(() => {
    let stopped = false;
    api.bootstrap("KITCHEN").then((response) => {
      if (stopped) return;
      applySession(response.session);
      setOrders(response.orders);
      setLastUpdated(new Date());
    }).catch(() => setOffline(true));
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    return startVisiblePolling((signal) => refresh(signal), 5000);
  }, [token]);

  useEffect(() => {
    void unlockNotificationSound();
    void requestWakeLock();

    const unlockOnInteraction = () => {
      void unlockNotificationSound();
      void requestWakeLock();
    };
    const unlockOnVisible = () => {
      if (!document.hidden) {
        void unlockNotificationSound();
        void requestWakeLock();
      }
    };

    window.addEventListener("pointerdown", unlockOnInteraction, { once: true, passive: true });
    window.addEventListener("keydown", unlockOnInteraction, { once: true });
    document.addEventListener("visibilitychange", unlockOnVisible);
    window.addEventListener("focus", unlockOnVisible);

    return () => {
      window.removeEventListener("pointerdown", unlockOnInteraction);
      window.removeEventListener("keydown", unlockOnInteraction);
      document.removeEventListener("visibilitychange", unlockOnVisible);
      window.removeEventListener("focus", unlockOnVisible);
    };
  }, []);

  async function markReady(order: Order) {
    const pickup = order.fulfillment_type === "pickup";
    const pickupTime = pickup ? timeHHMM(order.pickup_at || order.created_at) : "";
    const message = pickup
      ? `Заказ #${order.public_number} готов к самовывозу в ${pickupTime}? Клиент получит уведомление, курьер — нет.`
      : `Заказ #${order.public_number} готов и передаётся курьеру?`;
    const confirmed = await askConfirm({ title: `Заказ #${order.public_number}`, message, confirmLabel: pickup ? "Готов к самовывозу" : "Передать курьеру" });
    if (!confirmed) return;
    markSeen(order);
    setBusy(order.id);
    setActionError("");
    try {
      const updated = await withAuth((authToken) => api.markReady(authToken, order.id, `ready-${order.id}-${order.version}`, order.version));
      markSeen(updated);
      setOrders((current) => pickup
        ? current.map((entry) => entry.id === updated.id ? updated : entry)
        : current.filter((entry) => entry.id !== order.id));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function markPickupCollected(order: Order) {
    const confirmed = await askConfirm({ title: `Заказ #${order.public_number}`, message: "Заказ выдан клиенту?", confirmLabel: "Выдано" });
    if (!confirmed) return;
    markSeen(order);
    setBusy(order.id);
    setActionError("");
    try {
      await withAuth((authToken) => api.markPickupCollected(authToken, order.id, `picked-up-${order.id}-${order.version}`, order.version));
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Кухня</h1>
          <p>{lastUpdated ? `Обновлено ${secondsAgo(lastUpdated)} сек назад` : "Ожидание заказов"}</p>
        </div>
        <button className="icon" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={20} /></button>
      </header>
      {offline && <div className="status bad"><WifiOff size={18} /><span>Нет связи с сервером</span></div>}
      {actionError && <div className="status bad"><AlertTriangle size={18} /><span>{actionError}</span></div>}
      {isOwnerTelegramId(telegramUserId) && <OwnerRoleSwitch activeRole="KITCHEN" />}
      <nav className="kitchen-window-tabs" aria-label="Тип заказов">
        <button className={activeWindow === "delivery" ? "active" : ""} onClick={() => setActiveWindow("delivery")}>ДОСТАВКА <b>{sortedDeliveryOrders.length}</b></button>
        <button className={activeWindow === "pickup" ? "active" : ""} onClick={() => setActiveWindow("pickup")}>САМОВЫВОЗ <b>{sortedPickupOrders.length + sortedPickupReadyOrders.length}</b></button>
      </nav>
      <main className="kitchen-board">
        <section className={`order-window delivery-window ${activeWindow === "delivery" ? "mobile-active" : ""}`}>
          <div className="desktop-window-title"><h2>Доставка</h2><span>{sortedDeliveryOrders.length}</span></div>
          <div className="window-list">
            {!sortedDeliveryOrders.length && <div className="empty">Пока заказов нет</div>}
            {sortedDeliveryOrders.map((order) => <KitchenOrderCard key={order.id} order={order} seenIds={seenIds} busy={busy} onSeen={markSeen} onPrimary={markReady} />)}
          </div>
        </section>
        <section className={`order-window pickup-window ${activeWindow === "pickup" ? "mobile-active" : ""}`}>
          <div className="desktop-window-title"><h2>Самовывоз</h2><span>{sortedPickupOrders.length + sortedPickupReadyOrders.length}</span></div>
          <div className="window-list">
            {!!sortedPickupReadyOrders.length && <OrderGroup title="ГОТОВЫ К ВЫДАЧЕ" count={sortedPickupReadyOrders.length} tone="ready">{sortedPickupReadyOrders.map((order) => <KitchenOrderCard key={order.id} order={order} seenIds={seenIds} busy={busy} onSeen={markSeen} onPrimary={markPickupCollected} />)}</OrderGroup>}
            {!!pickupDueOrders.length && <OrderGroup title="ГОТОВИТЬ СЕЙЧАС" count={pickupDueOrders.length} tone="urgent">{pickupDueOrders.map((order) => <KitchenOrderCard key={order.id} order={order} seenIds={seenIds} busy={busy} onSeen={markSeen} onPrimary={markReady} />)}</OrderGroup>}
            {!!pickupLaterOrders.length && <OrderGroup title="ПОЗЖЕ СЕГОДНЯ" count={pickupLaterOrders.length}>{pickupLaterOrders.map((order) => <FuturePickupRow key={order.id} order={order} />)}</OrderGroup>}
            {!sortedPickupOrders.length && !sortedPickupReadyOrders.length && <div className="empty">Пока заказов нет</div>}
          </div>
        </section>
      </main>
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />}
    </div>
  );
}

function OrderGroup({ title, count, tone = "", children }: { title: string; count: number; tone?: string; children: ReactNode }) {
  return <section className={`order-group ${tone}`}><h2>{title} <b>{count}</b></h2>{children}</section>;
}

function FuturePickupRow({ order }: { order: Order }) {
  return <article className="future-pickup"><time>{timeHHMM(order.pickup_at || order.created_at)}</time><div><strong>#{order.public_number} · {clientLabel(order)}</strong><span>{order.items.map((item) => `${item.quantity}× ${item.snapshot_title}`).join(" · ")}</span></div></article>;
}

function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmDialogState; onClose(confirmed: boolean): void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => onClose(false)}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => onClose(false)}>Отмена</button>
          <button className="primary" type="button" onClick={() => onClose(true)}>{dialog.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function KitchenOrderCard({
  order,
  seenIds,
  busy,
  onSeen,
  onPrimary,
}: {
  order: Order;
  seenIds: Set<string>;
  busy: string;
  onSeen(order: Order): void;
  onPrimary(order: Order): void;
}) {
  const unread = !seenIds.has(seenKey(order));
  const addedAt = order.latest_addition?.created_at;
  const pickup = order.fulfillment_type === "pickup";
  const pickupReady = isPickupReady(order);
  return (
    <article className={`order-row${unread ? " is-new" : ""}${order.latest_addition ? " has-addition" : ""}${pickup ? ` is-pickup ${pickupUrgencyClass(order)}` : ""}`} onClick={() => onSeen(order)}>
      <OrderAvatar order={order} unread={unread} />
      <div className="order-main">
        <div className="order-top">
          <div className="order-title">
            <strong>Заказ #{order.public_number}</strong>
            <span>{pickup ? pickupTimingText(order) : kitchenTimeText(order)}</span>
          </div>
          <div className="order-side">
            <span className={unread ? "new-badge" : "read-badge"}>{unread ? "Новый" : "Прочитано"}</span>
            <Menu order={order} />
          </div>
        </div>
        <div className="order-meta-line">
          <CustomerBadge order={order} />
          <span className={pickup ? "fulfillment-chip pickup" : "fulfillment-chip"}>{pickup ? "Самовывоз" : "Доставка"}</span>
          <span className="payment-chip">{paymentText(order)}</span>
        </div>
        <ul className="items-compact" aria-label={`Блюда заказа #${order.public_number}`}>
          {order.items.map((item, index) => (
            <li className={item.addition_id ? "is-added-item" : ""} key={`${item.menu_item_id}-${index}`}>
              <b>{item.quantity}×</b>
              <span>
                {item.snapshot_title}
                {item.addition_id && <small>Добавлено{item.addition_created_at ? ` в ${timeHHMM(item.addition_created_at)}` : ""}</small>}
              </span>
            </li>
          ))}
        </ul>
        {addedAt && <p className="addition-note">Дозаказ добавлен в {timeHHMM(addedAt)}</p>}
        {order.customer_comment && <p className="comment compact-comment"><AlertTriangle size={16} /> {order.customer_comment}</p>}
        <button
          className="primary compact-action"
          disabled={busy === order.id}
          onClick={(event) => {
            event.stopPropagation();
            void onPrimary(order);
          }}
        >
          <Check size={20} /> {pickupReady ? "ВЫДАНО" : pickup ? "ГОТОВ К САМОВЫВОЗУ" : "ЗАКАЗ ГОТОВ"}
        </button>
      </div>
    </article>
  );
}

function isPickupReady(order: Order): boolean {
  return order.fulfillment_type === "pickup" && order.fulfillment_status === "READY_FOR_PICKUP";
}

function pickupTimestamp(order: Order): number { return new Date(order.pickup_at || order.created_at).getTime(); }
function pickupCookTimestamp(order: Order): number { return new Date(order.pickup_cook_at || order.pickup_at || order.created_at).getTime(); }

function pickupTimingText(order: Order): string {
  if (isPickupReady(order)) return `Готов · заберут в ${timeHHMM(order.pickup_at || order.created_at)}`;
  const minutes = Math.ceil((pickupTimestamp(order) - Date.now()) / 60000);
  if (minutes <= 0) return `ЗАБЕРУТ СЕЙЧАС · ${timeHHMM(order.pickup_at || order.created_at)}`;
  return `Заберут в ${timeHHMM(order.pickup_at || order.created_at)} · через ${minutes} мин`;
}

function pickupUrgencyClass(order: Order): string {
  if (isPickupReady(order)) return "pickup-ready";
  const minutes = (pickupTimestamp(order) - Date.now()) / 60000;
  if (minutes <= 15) return "pickup-now";
  if (minutes <= 30) return "pickup-soon";
  return "";
}

function OrderAvatar({ order, unread }: { order: Order; unread: boolean }) {
  return (
    <span className="order-avatar" aria-hidden="true">
      {order.client_photo_url ? <img src={order.client_photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{clientInitials(order)}</span>}
      <small>#{order.public_number}</small>
      {unread && <i />}
    </span>
  );
}

function CustomerBadge({ order }: { order: Order }) {
  const href = telegramUserLink(order);
  const content = (
    <>
      <span className="customer-avatar">
        <span>{clientInitials(order)}</span>
        {order.client_photo_url && <img src={order.client_photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <b>{clientLabel(order)}</b>
    </>
  );
  if (!href) return <div className="customer-badge" title={clientLabel(order)}>{content}</div>;
  return (
    <a
      className="customer-badge is-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Открыть ЛС ${clientLabel(order)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openTelegramLink(href);
      }}
    >
      {content}
    </a>
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

function Menu({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu">
      <button
        className="icon row-icon"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        aria-label="Ещё"
      >
        <MoreVertical size={20} />
      </button>
      {open && (
        <div className="popover" onClick={(event) => event.stopPropagation()}>
          <a href={problemLink(order)} target="_blank" rel="noreferrer">Сообщить о проблеме</a>
          <span>Сумма: {money(order.total_minor)}</span>
        </div>
      )}
    </div>
  );
}

function secondsAgo(value: Date) {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
}

function seenKey(order: Order): string {
  const addition = order.latest_addition?.id || "base";
  return `${order.id}:${order.version}:${addition}`;
}

function timeHHMM(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function loadSeenOrderIds(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  } catch {
    // Local read markers are nice-to-have only.
  }
  return new Set();
}

function saveSeenOrderIds(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...value].slice(-200)));
  } catch {
    // Local read markers are nice-to-have only.
  }
}

function clientInitials(order: Order): string {
  const source = (order.client_first_name || order.client_username || "TG").trim();
  return source.slice(0, 2).toUpperCase();
}

function staffActionErrorText(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "ORDER_STATUS_CONFLICT") return "Заказ уже изменился. Экран обновлён, проверьте актуальный статус.";
  if (code === "IDEMPOTENCY_CONFLICT") return "Действие уже отправляется. Подождите и обновите экран.";
  if (code === "RATE_LIMITED") return "Слишком много запросов. Подождите минуту и попробуйте ещё раз.";
  if (code === "FORBIDDEN" || code === "AUTH_INVALID") return "Сессия устарела или нет доступа. Откройте Mini App заново из Telegram.";
  return "Действие не выполнено. Экран обновлён, попробуйте ещё раз.";
}

async function requestWakeLock() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
    await nav.wakeLock?.request("screen");
  } catch {
    // Wake Lock is best-effort. The UI should stay simple for staff.
  }
}

async function unlockNotificationSound() {
  const ctx = getNotificationAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;
    playSilentUnlockTone(ctx);
    if (pendingNotificationSound) {
      pendingNotificationSound = false;
      window.setTimeout(() => playBeep(), 60);
    }
  } catch {
    // Browser/WebView will allow audio after a real user gesture.
  }
}

function playBeep() {
  const ctx = getNotificationAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume().then(() => {
      if (ctx.state === "running") {
        playBeepNow(ctx);
      } else {
        pendingNotificationSound = true;
      }
    }).catch(() => {
      pendingNotificationSound = true;
    });
    return;
  }

  if (ctx.state !== "running") {
    pendingNotificationSound = true;
    return;
  }

  playBeepNow(ctx);
}

function getNotificationAudioContext() {
  if (notificationAudioContext && notificationAudioContext.state !== "closed") return notificationAudioContext;

  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  notificationAudioContext = new AudioContextClass();
  return notificationAudioContext;
}

function playSilentUnlockTone(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.00001, now);
  osc.frequency.setValueAtTime(440, now);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.03);
}

function playBeepNow(ctx: AudioContext) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.8, now);
  master.connect(ctx.destination);

  [0, 0.22, 0.44, 0.82, 1.04, 1.26].forEach((offset, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + offset;
    const end = start + 0.18;
    osc.type = "square";
    osc.frequency.setValueAtTime(index % 2 === 0 ? 880 : 1175, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
  });

  window.setTimeout(() => master.disconnect(), 1800);
}
