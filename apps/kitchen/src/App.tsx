import type { Order, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, isAuthError, money, openTelegramLink, problemLink, sameOrderSnapshot, startVisiblePolling, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, ChevronDown, Clock3, MoreVertical, RefreshCw, Timer, WifiOff } from "lucide-react";
import { useDrag } from "@use-gesture/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

const api = createStaffApi("KITCHEN");
const kitchenSeenOrdersKey = "tk-kitchen-seen-orders-v2";
const notificationSoundUrl = `${import.meta.env.BASE_URL}new-order-notification.mp3`;
const devSandbox = import.meta.env.VITE_DEV_SANDBOX === "true";
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
  const lastUpdatedRef = useRef<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [etaBusy, setEtaBusy] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [activeWindow, setActiveWindow] = useState<"delivery" | "pickup">("delivery");
  const [activeLane, setActiveLane] = useState<"new" | "in_progress" | "ready">("new");
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
  const sortedDeliveryOrders = useMemo(() => [...deliveryOrders].sort((a, b) => new Date(a.delivery_target_at || a.created_at).getTime() - new Date(b.delivery_target_at || b.created_at).getTime()), [deliveryOrders]);
  const sortedPickupOrders = useMemo(() => [...pickupOrders].sort((a, b) => pickupTimestamp(a) - pickupTimestamp(b)), [pickupOrders]);
  const sortedPickupReadyOrders = useMemo(() => [...pickupReadyOrders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [pickupReadyOrders]);
  const visibleNewOrders = useMemo(() => (activeWindow === "delivery" ? sortedDeliveryOrders : sortedPickupOrders).filter((order) => !order.kitchen_started_at), [activeWindow, sortedDeliveryOrders, sortedPickupOrders]);
  const visibleInProgressOrders = useMemo(() => (activeWindow === "delivery" ? sortedDeliveryOrders : sortedPickupOrders).filter((order) => Boolean(order.kitchen_started_at)), [activeWindow, sortedDeliveryOrders, sortedPickupOrders]);

  useEffect(() => installPerformanceBeacon("kitchen", () => "orders"), []);
  useEffect(() => {
    const checkDueOrders = () => {
      const dueOrders = sortedPickupOrders.filter((order) => pickupCookTimestamp(order) <= Date.now());
      const dueNow = dueOrders.filter((order) => !dueAlertedIds.current.has(order.id));
      dueOrders.forEach((order) => dueAlertedIds.current.add(order.id));
      if (dueNow.length) playBeep();
    };
    checkDueOrders();
    const timer = window.setInterval(checkDueOrders, 15000);
    return () => window.clearInterval(timer);
  }, [sortedPickupOrders]);

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
      setOrders((current) => sameOrderSnapshot(current, response.orders) ? current : response.orders);
      lastUpdatedRef.current = new Date();
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
      lastUpdatedRef.current = new Date();
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

  async function estimateReady(order: Order, minutes?: number, estimatedReadyAt?: string) {
    if (etaBusy || order.fulfillment_type !== "delivery" || order.fulfillment_status !== "NEW") return;
    const target = estimatedReadyAt || new Date(Date.now() + (minutes || 30) * 60000).toISOString();
    if (order.estimated_ready_at && Math.abs(new Date(order.estimated_ready_at).getTime() - new Date(target).getTime()) < 60000) return;
    setEtaBusy(`${order.id}:${minutes || "target"}`);
    setActionError("");
    try {
      const updated = await withAuth((authToken) => api.estimateKitchenReady(authToken, order.id, {
        ...(estimatedReadyAt ? { estimated_ready_at: estimatedReadyAt } : { ready_in_minutes: minutes }),
        expected_version: order.version,
      }, `eta-${order.id}-${order.version}-${minutes || estimatedReadyAt}`));
      setOrders((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setEtaBusy("");
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
          <h1>Кухня{devSandbox && <span className="dev-environment-badge">DEV</span>}</h1>
          <LastUpdatedText valueRef={lastUpdatedRef} empty="Ожидание заказов" prefix="Обновлено" />
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
        etaBusy={etaBusy}
        inProgressOrders={visibleInProgressOrders}
        newOrders={visibleNewOrders}
        onLaneChange={setActiveLane}
        onMarkReady={markReady}
        onEstimateReady={estimateReady}
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
  etaBusy,
  inProgressOrders,
  newOrders,
  onLaneChange,
  onMarkReady,
  onEstimateReady,
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
  etaBusy: string;
  inProgressOrders: Order[];
  newOrders: Order[];
  onLaneChange(lane: KitchenLane): void;
  onMarkReady(order: Order): void;
  onEstimateReady(order: Order, minutes?: number, estimatedReadyAt?: string): void;
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
                    etaBusy={etaBusy}
                    canStart={lane.id === "new"}
                    onSeen={onSeen}
                    onStart={onStartPreparation}
                    onPrimary={lane.id === "ready" ? onPickupCollected : onMarkReady}
                    onEstimateReady={onEstimateReady}
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
  etaBusy,
  canStart,
  onSeen,
  onStart,
  onPrimary,
  onEstimateReady,
  onResetPreparation,
}: {
  order: Order;
  seenIds: Set<string>;
  busy: string;
  etaBusy: string;
  canStart: boolean;
  onSeen(order: Order): void;
  onStart(order: Order): void;
  onPrimary(order: Order): void;
  onEstimateReady(order: Order, minutes?: number, estimatedReadyAt?: string): void;
  onResetPreparation(order: Order): void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<number | undefined>(undefined);
  const animationFrameRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const draggable = canStart && busy !== order.id && order.fulfillment_status === "NEW" && !order.kitchen_started_at;

  function renderOffset(value: number) {
    offsetRef.current = value;
    if (cardRef.current) cardRef.current.style.transform = `translate3d(${value}px, 0, 0)`;
    if (revealRef.current) revealRef.current.style.opacity = String(Math.min(1, Math.max(0, value / 72)));
  }

  function stopAnimation() {
    if (animationFrameRef.current === null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }

  function animateOffset(target: number, onRest?: () => void) {
    stopAnimation();
    let position = offsetRef.current;
    let velocity = 0;
    let previousTime = performance.now();
    const tick = (time: number) => {
      const delta = Math.min(0.032, Math.max(0.001, (time - previousTime) / 1000));
      previousTime = time;
      const acceleration = (-480 * (position - target) - 39 * velocity) / 0.78;
      velocity += acceleration * delta;
      position += velocity * delta;
      renderOffset(position);
      if (Math.abs(position - target) < 0.45 && Math.abs(velocity) < 4) {
        renderOffset(target);
        animationFrameRef.current = null;
        onRest?.();
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }

  const bindDrag = useDrag(({ active, first, movement: [movementX], velocity: [velocityX] }) => {
    if (!draggable) return;
    const x = Math.max(0, Math.min(112, movementX));
    if (active) {
      if (first) {
        stopAnimation();
        setDragging(true);
      }
      renderOffset(x);
      return;
    }
    setDragging(false);
    const width = shellRef.current?.clientWidth || 320;
    const threshold = Math.min(104, Math.max(68, width * 0.24));
    const committed = x >= threshold || (x >= 42 && velocityX >= 0.62);
    if (!committed) {
      animateOffset(0);
      return;
    }
    animateOffset(112, () => {
      onStart(order);
      commitTimerRef.current = window.setTimeout(() => animateOffset(0), 120);
    });
  }, {
    axis: "x",
    bounds: { left: 0, right: 112 },
    rubberband: 0.08,
    threshold: 6,
    filterTaps: true,
  });

  useEffect(() => () => {
    stopAnimation();
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
      {draggable && <div ref={revealRef} className="swipe-reveal" aria-hidden="true"><span>В ПРОЦЕССЕ</span><b>→</b></div>}
      <div
        ref={cardRef}
        {...(draggable ? bindDrag() : {})}
        className={`swipe-card${dragging ? " is-dragging" : ""}`}
        style={{ touchAction: "pan-y" }}
      >
        <KitchenOrderCard
          order={order}
          seenIds={seenIds}
          busy={busy}
          etaBusy={etaBusy}
          onSeen={onSeen}
          onPrimary={onPrimary}
          onEstimateReady={onEstimateReady}
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
  etaBusy,
  onSeen,
  onPrimary,
  onEstimateReady,
  onResetPreparation,
}: {
  order: Order;
  seenIds: Set<string>;
  busy: string;
  etaBusy: string;
  onSeen(order: Order): void;
  onPrimary(order: Order): void;
  onEstimateReady(order: Order, minutes?: number, estimatedReadyAt?: string): void;
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
          </div>
          <div className="order-side">
            {order.kitchen_started_at
              ? <span className="progress-badge">В процессе</span>
              : <span className={unread ? "new-badge" : "read-badge"}>{unread ? "Новый" : "Прочитано"}</span>}
            <Menu order={order} busy={busy === order.id} onResetPreparation={onResetPreparation} onEstimateReady={onEstimateReady} />
          </div>
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
        <div className="order-meta-line">
          <CustomerBadge order={order} />
          <i aria-hidden="true">·</i>
          <span>{pickup ? "Самовывоз" : "Доставка"}</span>
          <i aria-hidden="true">·</i>
          <span>{compactPaymentText(order)} · {money(order.total_minor)}</span>
        </div>
        <KitchenTiming order={order} etaBusy={etaBusy} onEstimateReady={onEstimateReady} />
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

function KitchenTiming({
  order,
  etaBusy,
  onEstimateReady,
}: {
  order: Order;
  etaBusy: string;
  onEstimateReady(order: Order, minutes?: number, estimatedReadyAt?: string): void;
}) {
  const pickup = order.fulfillment_type === "pickup";
  const target = order.pickup_at || order.delivery_target_at;
  const exactOptions = readyTimeOptions();
  const [timePicker, setTimePicker] = useState<"minutes" | "clock" | null>(null);
  const quickOptions = [5, 10, 20, 30, 40, 60];

  return (
    <section className={`kitchen-timing${pickup ? " pickup" : ""}`} aria-label="Время заказа" onClick={(event) => event.stopPropagation()}>
      {pickup ? (
        <div className="kitchen-timing-summary">
          <div>
            <small>Поступил</small>
            <b>{timeHHMM(order.created_at)}</b>
            <span>{elapsedShort(order.created_at)}</span>
          </div>
          <div>
            <small>Заберут</small>
            <b>{target ? timeHHMM(target) : "Сейчас"}</b>
            {target && <span>{pickupCountdown(order)}</span>}
          </div>
        </div>
      ) : (
        <div className="delivery-time-status">
          <span>Клиент просил</span>
          <strong>{target ? `примерно к ${timeHHMM(target)}` : "как можно скорее"}</strong>
          {Boolean(order.delivery_queue_delay_minutes) && <small>Очередь +{order.delivery_queue_delay_minutes} мин</small>}
        </div>
      )}
      {!pickup && (
        <div className="kitchen-timing-actions" aria-label="Сообщить время готовности">
          <div className="kitchen-time-question">
            <strong>Когда будет готов?</strong>
            <span>{order.estimated_ready_at ? `Клиенту сообщили: примерно к ${timeHHMM(order.estimated_ready_at)}` : "Время клиенту ещё не сообщали"}</span>
          </div>
          <div className="kitchen-time-buttons">
            <button
              type="button"
              disabled={Boolean(etaBusy)}
              aria-expanded={timePicker === "minutes"}
              onClick={() => setTimePicker("minutes")}
            >
              <Timer size={16} />
              <span><strong>Через…</strong><small>5–60 минут</small></span>
              <ChevronDown size={16} />
            </button>
            <button
              type="button"
              disabled={Boolean(etaBusy)}
              aria-expanded={timePicker === "clock"}
              onClick={() => setTimePicker("clock")}
            >
              <Clock3 size={16} />
              <span><strong>Ко времени…</strong><small>например 14:45</small></span>
              <ChevronDown size={16} />
            </button>
          </div>
          {timePicker && createPortal(
            <div className="ready-time-backdrop" onClick={() => setTimePicker(null)}>
              <section className="ready-time-sheet" role="dialog" aria-modal="true" aria-label="Выбор времени готовности" onClick={(event) => event.stopPropagation()}>
                <header>
                  <div>
                    <small>Клиент просил: {target ? `примерно к ${timeHHMM(target)}` : "как можно скорее"}</small>
                    <strong>{timePicker === "minutes" ? "Через сколько будет готов?" : "К какому времени будет готов?"}</strong>
                  </div>
                  <button type="button" onClick={() => setTimePicker(null)} aria-label="Закрыть">×</button>
                </header>
                <div className="ready-time-list" role="listbox" aria-label="Время готовности">
                  {timePicker === "minutes" ? quickOptions.map((minutes) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={etaMatchesMinutes(order, minutes)}
                      className={etaMatchesMinutes(order, minutes) ? "active" : ""}
                      key={minutes}
                      onClick={() => {
                        setTimePicker(null);
                        onEstimateReady(order, minutes);
                      }}
                    >
                      <span>{minutes} минут</span>
                      {etaMatchesMinutes(order, minutes) && <Check size={17} />}
                    </button>
                  )) : exactOptions.map((option) => {
                    const selected = sameReadyTime(order.estimated_ready_at, option.at);
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? "active" : ""}
                        key={option.at}
                        onClick={() => {
                          setTimePicker(null);
                          onEstimateReady(order, undefined, option.at);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected && <Check size={17} />}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>,
            document.body,
          )}
        </div>
      )}
    </section>
  );
}

function isPickupReady(order: Order): boolean {
  return order.fulfillment_type === "pickup" && order.fulfillment_status === "READY_FOR_PICKUP";
}

function pickupTimestamp(order: Order): number { return new Date(order.pickup_at || order.created_at).getTime(); }
function pickupCookTimestamp(order: Order): number { return new Date(order.pickup_cook_at || order.pickup_at || order.created_at).getTime(); }

function pickupCountdown(order: Order): string {
  if (isPickupReady(order)) return "Заказ готов";
  const minutes = Math.ceil((pickupTimestamp(order) - Date.now()) / 60000);
  if (minutes <= 0) return "Сейчас";
  return `Через ${minutes} мин`;
}

function pickupUrgencyClass(order: Order): string {
  if (isPickupReady(order)) return "pickup-ready";
  const minutes = (pickupTimestamp(order) - Date.now()) / 60000;
  if (minutes <= 15) return "pickup-now";
  if (minutes <= 30) return "pickup-soon";
  return "";
}

function etaMatchesMinutes(order: Order, minutes: number): boolean {
  if (!order.estimated_ready_at || !order.estimated_ready_updated_at) return false;
  const delta = new Date(order.estimated_ready_at).getTime() - new Date(order.estimated_ready_updated_at).getTime();
  return Math.abs(delta - minutes * 60000) < 90000;
}

function readyTimeOptions(): Array<{ at: string; label: string }> {
  const first = new Date();
  first.setMinutes(Math.floor(first.getMinutes() / 5) * 5 + 5, 0, 0);
  return Array.from({ length: 36 }, (_, index) => {
    const target = new Date(first.getTime() + index * 5 * 60000);
    return { at: target.toISOString(), label: timeHHMM(target.toISOString()) };
  });
}

function sameReadyTime(current: string | undefined, candidate: string): boolean {
  return Boolean(current) && Math.abs(new Date(current!).getTime() - new Date(candidate).getTime()) < 60000;
}

function OrderAvatar({ order, unread }: { order: Order; unread: boolean }) {
  return (
    <span className="order-avatar" aria-hidden="true">
      {order.client_photo_url ? <img src={order.client_photo_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span>{clientInitials(order)}</span>}
      {unread && <i />}
    </span>
  );
}

function CustomerBadge({ order }: { order: Order }) {
  const href = telegramUserLink(order);
  const content = <b>{clientLabel(order)}</b>;
  if (!href) return <div className="customer-badge" title={clientLabel(order)}>{content}</div>;
  return (
    <a
      className="customer-badge is-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Открыть ЛС ${clientLabel(order)}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (openTelegramLink(href)) event.preventDefault();
      }}
    >
      {content}
    </a>
  );
}

function compactPaymentText(order: Order): string {
  if (order.payment_method === "cash") return "Наличные";
  if (order.payment_method === "card") return "Карта";
  if (order.payment_method === "crypto") return "Crypto";
  return "Оплачено";
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

function Menu({ order, busy, onResetPreparation, onEstimateReady }: { order: Order; busy: boolean; onResetPreparation(order: Order): void; onEstimateReady(order: Order, minutes?: number): void }) {
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(30);
  const [customOpen, setCustomOpen] = useState(false);
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
          {order.fulfillment_type === "delivery" && order.fulfillment_status === "NEW" && (
            customOpen ? <div className="custom-eta-control">
              <label><span>Минут</span><input type="number" min={5} max={180} step={5} value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} /></label>
              <button type="button" disabled={busy || customMinutes < 5 || customMinutes > 180 || customMinutes % 5 !== 0} onClick={() => { setOpen(false); setCustomOpen(false); onEstimateReady(order, customMinutes); }}>Отправить</button>
            </div> : <button type="button" disabled={busy} onClick={() => setCustomOpen(true)}>Другое время</button>
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

function LastUpdatedText({ valueRef, empty, prefix }: { valueRef: RefObject<Date | null>; empty: string; prefix: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const value = valueRef.current;
  return <>{value ? `${prefix} ${secondsAgo(value)} сек назад` : empty}</>;
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

function elapsedShort(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин назад` : `${hours} ч назад`;
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
