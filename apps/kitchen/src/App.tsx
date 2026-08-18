import type { Order, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, isAuthError, kitchenTimeText, money, openTelegramLink, paymentText, problemLink, startVisiblePolling, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, MoreVertical, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("KITCHEN");
const kitchenSeenOrdersKey = "tk-kitchen-seen-orders-v2";
let notificationAudioContext: AudioContext | null = null;
let pendingNotificationSound = false;

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");
  const seenIdsRef = useRef(loadSeenOrderIds(kitchenSeenOrdersKey));
  const notifiedIds = useRef(new Set<string>());
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(seenIdsRef.current));
  const authRetry = useMemo(() => createSingleFlightAuthRetry({
    authenticate,
    isAuthError,
  }), []);

  const newOrders = useMemo(() => orders.filter((order) => order.fulfillment_status === "NEW"), [orders]);
  const pickupReadyOrders = useMemo(() => orders.filter(isPickupReady), [orders]);
  const sortedNewOrders = useMemo(() => [...newOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [newOrders]);
  const sortedPickupReadyOrders = useMemo(() => [...pickupReadyOrders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [pickupReadyOrders]);

  useEffect(() => installPerformanceBeacon("kitchen", () => "orders"), []);

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

  async function refresh(signal?: AbortSignal, authToken = token) {
    try {
      const response = await withAuth((currentToken) => api.listKitchenOrders(currentToken, signal), authToken);
      const incoming = response.orders.filter((order) => !seenIdsRef.current.has(seenKey(order)) && !notifiedIds.current.has(seenKey(order)));
      response.orders.forEach((order) => notifiedIds.current.add(seenKey(order)));
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
    const message = pickup
      ? `Заказ #${order.public_number} готов к самовывозу? Клиент получит уведомление, курьер — нет.`
      : `Заказ #${order.public_number} готов и передаётся курьеру?`;
    if (!window.confirm(message)) return;
    markSeen(order);
    setBusy(order.id);
    try {
      const updated = await withAuth((authToken) => api.markReady(authToken, order.id, `ready-${order.id}-${order.version}`, order.version));
      markSeen(updated);
      setOrders((current) => pickup
        ? current.map((entry) => entry.id === updated.id ? updated : entry)
        : current.filter((entry) => entry.id !== order.id));
    } catch {
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function markPickupCollected(order: Order) {
    if (!window.confirm(`Заказ #${order.public_number} выдан клиенту?`)) return;
    markSeen(order);
    setBusy(order.id);
    try {
      await withAuth((authToken) => api.markPickupCollected(authToken, order.id, `picked-up-${order.id}-${order.version}`, order.version));
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch {
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
          <p>{sortedNewOrders.length} новых · {sortedPickupReadyOrders.length} самовывоз · {lastUpdated ? `обновлено ${secondsAgo(lastUpdated)} сек назад` : "ожидание"}</p>
        </div>
        <button className="icon" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={20} /></button>
      </header>
      {offline && <div className="status bad"><WifiOff size={18} /><span>Нет связи с сервером</span></div>}
      {isOwnerTelegramId(telegramUserId) && <OwnerRoleSwitch activeRole="KITCHEN" />}
      <main className="list">
        {sortedNewOrders.length === 0 && sortedPickupReadyOrders.length === 0 ? <div className="empty">Новых заказов и самовывоза нет</div> : null}
        {sortedNewOrders.map((order) => (
          <KitchenOrderCard
            key={order.id}
            order={order}
            seenIds={seenIds}
            busy={busy}
            onSeen={markSeen}
            onPrimary={markReady}
          />
        ))}
        {sortedPickupReadyOrders.length > 0 && (
          <section className="pickup-section" aria-label="Самовывоз готов к выдаче">
            <h2>Самовывоз · готово</h2>
            {sortedPickupReadyOrders.map((order) => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                seenIds={seenIds}
                busy={busy}
                onSeen={markSeen}
                onPrimary={markPickupCollected}
              />
            ))}
          </section>
        )}
      </main>
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
    <article className={`order-row${unread ? " is-new" : ""}${order.latest_addition ? " has-addition" : ""}${pickup ? " is-pickup" : ""}`} onClick={() => onSeen(order)}>
      <OrderAvatar order={order} unread={unread} />
      <div className="order-main">
        <div className="order-top">
          <div className="order-title">
            <strong>Заказ #{order.public_number}</strong>
            <span>{kitchenTimeText(order)}</span>
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
  return order.fulfillment_type === "pickup" && order.fulfillment_status === "OUT_FOR_DELIVERY";
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
          <a href={problemLink(order)} target="_blank">Сообщить о проблеме</a>
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
