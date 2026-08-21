import type { Order, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, isAuthError, kitchenTimeText, money, openTelegramLink, paymentText, problemLink, startVisiblePolling, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, MoreVertical, RefreshCw, WifiOff } from "lucide-react";
import { useDrag } from "@use-gesture/react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("KITCHEN");
const kitchenSeenOrdersKey = "tk-kitchen-seen-orders-v2";
const notificationSoundUrl = `${import.meta.env.BASE_URL}new-order-notification.mp3`;
let notificationAudioContext: AudioContext | null = null;
let notificationAudioBuffer: AudioBuffer | null = null;
let notificationAudioBufferPromise: Promise<AudioBuffer> | null = null;
let pendingNotificationSound = false;
let notificationSoundPlayingUntil = 0;
type ConfirmDialogState = {
  title: string;
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
  const [activeLane, setActiveLane] = useState<"new" | "in_progress" | "ready">("new");
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
  const sortedPickupReadyOrders = useMemo(() => [...pickupReadyOrders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [pickupReadyOrders]);
  const visibleNewOrders = useMemo(() => (activeWindow === "delivery" ? sortedDeliveryOrders : sortedPickupOrders).filter((order) => !order.kitchen_started_at), [activeWindow, sortedDeliveryOrders, sortedPickupOrders]);
  const visibleInProgressOrders = useMemo(() => (activeWindow === "delivery" ? sortedDeliveryOrders : sortedPickupOrders).filter((order) => Boolean(order.kitchen_started_at)), [activeWindow, sortedDeliveryOrders, sortedPickupOrders]);

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
    const confirmed = await askConfirm({
      title: `Заказ #${order.public_number} готов?`,
      confirmLabel: pickup ? "Готов к самовывозу" : "Передать курьеру",
    });
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

  async function startPreparation(order: Order) {
    if (busy === order.id || order.kitchen_started_at || order.fulfillment_status !== "NEW") return;
    markSeen(order);
    setBusy(order.id);
    setActionError("");
    try {
      const updated = await withAuth((authToken) => api.startKitchenPreparation(authToken, order.id, `start-${order.id}-${order.version}`, order.version));
      markSeen(updated);
      setOrders((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function resetPreparation(order: Order) {
    if (busy === order.id || !order.kitchen_started_at || order.fulfillment_status !== "NEW") return;
    setBusy(order.id);
    setActionError("");
    try {
      const updated = await withAuth((authToken) => api.resetKitchenPreparation(authToken, order.id, `reset-preparation-${order.id}-${order.version}`, order.version));
      setOrders((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function markPickupCollected(order: Order) {
    const cash = order.payment_method === "cash" && order.payment_status !== "PAID";
    const confirmed = await askConfirm({
      title: `Заказ #${order.public_number} забран?`,
      confirmLabel: cash ? "Забран и оплачен" : "Забран",
    });
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
        <button className={activeWindow === "delivery" ? "active" : ""} onClick={() => { setActiveWindow("delivery"); if (activeLane === "ready") setActiveLane("new"); }}>ДОСТАВКА <b>{sortedDeliveryOrders.length}</b></button>
        <button className={activeWindow === "pickup" ? "active" : ""} onClick={() => setActiveWindow("pickup")}>САМОВЫВОЗ <b>{sortedPickupOrders.length + sortedPickupReadyOrders.length}</b></button>
      </nav>
      <PreparationBoard
        activeLane={activeLane}
        busy={busy}
        inProgressOrders={visibleInProgressOrders}
        newOrders={visibleNewOrders}
        onLaneChange={setActiveLane}
        onMarkReady={markReady}
        onPickupCollected={markPickupCollected}
        onResetPreparation={resetPreparation}
        onSeen={markSeen}
        onStartPreparation={startPreparation}
        pickup={activeWindow === "pickup"}
        readyOrders={activeWindow === "pickup" ? sortedPickupReadyOrders : []}
        seenIds={seenIds}
      />
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />}
    </div>
  );
}

type KitchenLane = "new" | "in_progress" | "ready";

function PreparationBoard({
  activeLane,
  busy,
  inProgressOrders,
  newOrders,
  onLaneChange,
  onMarkReady,
  onPickupCollected,
  onResetPreparation,
  onSeen,
  onStartPreparation,
  pickup,
  readyOrders,
  seenIds,
}: {
  activeLane: KitchenLane;
  busy: string;
  inProgressOrders: Order[];
  newOrders: Order[];
  onLaneChange(lane: KitchenLane): void;
  onMarkReady(order: Order): void;
  onPickupCollected(order: Order): void;
  onResetPreparation(order: Order): void;
  onSeen(order: Order): void;
  onStartPreparation(order: Order): void;
  pickup: boolean;
  readyOrders: Order[];
  seenIds: Set<string>;
}) {
  const lanes = [
    { id: "new" as const, label: "НОВЫЕ", orders: newOrders },
    { id: "in_progress" as const, label: "В ПРОЦЕССЕ", orders: inProgressOrders },
    ...(pickup ? [{ id: "ready" as const, label: "ГОТОВЫ", orders: readyOrders }] : []),
  ];
  return (
    <>
      <nav className={`preparation-tabs${pickup ? " has-ready" : ""}`} aria-label="Состояние приготовления">
        {lanes.map((lane) => (
          <button key={lane.id} className={activeLane === lane.id ? "active" : ""} onClick={() => onLaneChange(lane.id)}>
            {lane.label}<b>{lane.orders.length}</b>
          </button>
        ))}
      </nav>
      <main className={`preparation-board${pickup ? " has-ready" : ""}`}>
        {lanes.map((lane) => (
          <section key={lane.id} className={`preparation-lane lane-${lane.id}${activeLane === lane.id ? " mobile-active" : ""}`}>
            <header className="lane-title"><h2>{lane.label}</h2><span>{lane.orders.length}</span></header>
            <div className="lane-list">
              {lane.orders.map((order) => (
                  <SwipeableOrderCard
                    key={order.id}
                    order={order}
                    seenIds={seenIds}
                    busy={busy}
                    canStart={lane.id === "new"}
                    onSeen={onSeen}
                    onStart={onStartPreparation}
                    onPrimary={lane.id === "ready" ? onPickupCollected : onMarkReady}
                    onResetPreparation={onResetPreparation}
                  />
                ))}
              {!lane.orders.length && <div className="lane-empty">Нет заказов</div>}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}

function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmDialogState; onClose(confirmed: boolean): void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => onClose(false)}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-title">{dialog.title}</h2>
        <div className="dialog-actions">
          <button type="button" onClick={() => onClose(false)}>Отмена</button>
          <button className="primary" type="button" onClick={() => onClose(true)}>{dialog.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function SwipeableOrderCard({
  order,
  seenIds,
  busy,
  canStart,
  onSeen,
  onStart,
  onPrimary,
  onResetPreparation,
}: {
  order: Order;
  seenIds: Set<string>;
  busy: string;
  canStart: boolean;
  onSeen(order: Order): void;
  onStart(order: Order): void;
  onPrimary(order: Order): void;
  onResetPreparation(order: Order): void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<number | undefined>(undefined);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const draggable = canStart && busy !== order.id && order.fulfillment_status === "NEW" && !order.kitchen_started_at;
  const bindDrag = useDrag(({ active, movement: [movementX], velocity: [velocityX] }) => {
    if (!draggable) return;
    const x = Math.max(0, Math.min(112, movementX));
    setDragging(active);
    if (active) {
      setDragX(x);
      return;
    }
    const width = shellRef.current?.clientWidth || 320;
    const threshold = Math.min(104, Math.max(68, width * 0.24));
    const committed = x >= threshold || (x >= 42 && velocityX >= 0.62);
    if (!committed) {
      setDragX(0);
      return;
    }
    setDragX(112);
    commitTimerRef.current = window.setTimeout(() => {
      onStart(order);
      setDragX(0);
    }, 150);
  }, {
    axis: "x",
    bounds: { left: 0, right: 112 },
    rubberband: 0.08,
    threshold: 6,
    filterTaps: true,
  });

  useEffect(() => () => {
    if (commitTimerRef.current !== undefined) window.clearTimeout(commitTimerRef.current);
  }, []);

  useEffect(() => {
    if (!order.kitchen_started_at || !shellRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shellRef.current.animate(
      [{ opacity: 0.72, transform: "translate3d(-1rem, 0, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
      { duration: 260, easing: "cubic-bezier(.22, 1, .36, 1)" },
    );
  }, [order.kitchen_started_at]);

  return (
    <div
      ref={shellRef}
      className={`swipe-shell${draggable ? " can-swipe" : ""}`}
    >
      {draggable && <div className="swipe-reveal" aria-hidden="true"><span>В ПРОЦЕССЕ</span><b>→</b></div>}
      <div
        {...(draggable ? bindDrag() : {})}
        className={`swipe-card${dragging ? " is-dragging" : ""}`}
        style={{ touchAction: "pan-y", transform: `translate3d(${dragX}px, 0, 0)` }}
      >
        <KitchenOrderCard
          order={order}
          seenIds={seenIds}
          busy={busy}
          onSeen={onSeen}
          onPrimary={onPrimary}
          onResetPreparation={onResetPreparation}
        />
      </div>
    </div>
  );
}

function KitchenOrderCard({
  order,
  seenIds,
  busy,
  onSeen,
  onPrimary,
  onResetPreparation,
}: {
  order: Order;
  seenIds: Set<string>;
  busy: string;
  onSeen(order: Order): void;
  onPrimary(order: Order): void;
  onResetPreparation(order: Order): void;
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
            {order.kitchen_started_at
              ? <span className="progress-badge">В процессе</span>
              : <span className={unread ? "new-badge" : "read-badge"}>{unread ? "Новый" : "Прочитано"}</span>}
            <Menu order={order} busy={busy === order.id} onResetPreparation={onResetPreparation} />
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
          <Check size={20} /> {pickupReady ? (order.payment_method === "cash" && order.payment_status !== "PAID" ? "ЗАБРАН И ОПЛАЧЕН" : "ЗАБРАН") : pickup ? "ГОТОВ К САМОВЫВОЗУ" : "ЗАКАЗ ГОТОВ"}
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

function Menu({ order, busy, onResetPreparation }: { order: Order; busy: boolean; onResetPreparation(order: Order): void }) {
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
          {order.kitchen_started_at && order.fulfillment_status === "NEW" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onResetPreparation(order);
              }}
            >
              Вернуть в новые
            </button>
          )}
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
    void loadNotificationAudioBuffer(ctx).catch(() => undefined);
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
        void playNotificationSound(ctx);
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

  void playNotificationSound(ctx);
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

async function loadNotificationAudioBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  if (notificationAudioBuffer) return notificationAudioBuffer;
  if (notificationAudioBufferPromise) return notificationAudioBufferPromise;

  notificationAudioBufferPromise = fetch(notificationSoundUrl, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`Notification sound unavailable: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      notificationAudioBuffer = buffer;
      return buffer;
    })
    .catch((error) => {
      notificationAudioBufferPromise = null;
      throw error;
    });

  return notificationAudioBufferPromise;
}

async function playNotificationSound(ctx: AudioContext) {
  let buffer: AudioBuffer;
  try {
    buffer = await loadNotificationAudioBuffer(ctx);
  } catch {
    pendingNotificationSound = true;
    return;
  }

  const now = ctx.currentTime;
  if (now < notificationSoundPlayingUntil) return;

  const repeatGap = 0.16;
  const repeatCount = 3;
  const totalDuration = buffer.duration * repeatCount + repeatGap * (repeatCount - 1);
  notificationSoundPlayingUntil = now + totalDuration;
  pendingNotificationSound = false;

  for (let repeat = 0; repeat < repeatCount; repeat += 1) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.addEventListener("ended", () => source.disconnect(), { once: true });
    source.start(now + repeat * (buffer.duration + repeatGap));
  }
}
