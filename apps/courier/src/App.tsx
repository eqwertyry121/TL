import type { Order, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, courierEtaLink, courierTimeText, createStaffApi, isAuthError, mapLink, money, openTelegramLink, paymentText, problemLink, startVisiblePolling, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, Copy, MapPin, MoreVertical, Phone, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("COURIER");
const courierSeenOrdersKey = "tk-courier-seen-orders-v1";
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
  const [etaBusy, setEtaBusy] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const seenIdsRef = useRef(loadSeenOrderIds(courierSeenOrdersKey));
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(seenIdsRef.current));
  const authRetry = useMemo(() => createSingleFlightAuthRetry({
    authenticate,
    isAuthError,
  }), []);

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [orders]);

  useEffect(() => installPerformanceBeacon("courier", () => "orders"), []);

  function markSeen(orderId: string) {
    if (seenIdsRef.current.has(orderId)) return;
    const next = new Set(seenIdsRef.current);
    next.add(orderId);
    seenIdsRef.current = next;
    setSeenIds(next);
    saveSeenOrderIds(courierSeenOrdersKey, next);
  }

  function applySession(session: Awaited<ReturnType<typeof api.authenticate>>) {
    setToken(session.token);
    setTelegramUserId(session.telegram_user_id);
    setOffline(false);
    return session.token;
  }

  async function authenticate() {
    return applySession(await api.authenticate("COURIER"));
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
      const response = await withAuth((currentToken) => api.listCourierOrders(currentToken, signal), authToken);
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
    api.bootstrap("COURIER").then((response) => {
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

  async function markDelivered(order: Order) {
    const cash = order.payment_method === "cash" && order.payment_status !== "PAID";
    const confirmed = await askConfirm({
      title: `Заказ #${order.public_number} доставлен?`,
      confirmLabel: cash ? "Доставлено и оплачено" : "Доставлено",
    });
    if (!confirmed) return;
    markSeen(order.id);
    setBusy(order.id);
    setActionError("");
    try {
      await withAuth((authToken) => api.markDelivered(authToken, order.id, `delivered-${order.id}-${order.version}`, order.version));
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function sendETA(order: Order, minutes: number) {
    markSeen(order.id);
    const telegramLink = courierEtaLink(order, minutes);
    if (telegramLink) {
      openTelegramLink(telegramLink);
      return;
    }

    const key = `${order.id}:${minutes}`;
    setEtaBusy(key);
    setActionError("");
    try {
      await withAuth((authToken) => api.sendCourierETA(authToken, order.id, minutes));
    } catch (err) {
      setActionError(staffActionErrorText(err));
      await refresh();
    } finally {
      setEtaBusy("");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Курьер</h1>
          <p>{sortedOrders.length} в доставке · {lastUpdated ? `обновлено ${secondsAgo(lastUpdated)} сек назад` : "ожидание"}</p>
        </div>
        <button className="icon" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={20} /></button>
      </header>
      {offline && <div className="status bad"><WifiOff size={18} /><span>Нет связи с сервером</span></div>}
      {actionError && <div className="status bad"><AlertTriangle size={18} /><span>{actionError}</span></div>}
      {isOwnerTelegramId(telegramUserId) && <OwnerRoleSwitch activeRole="COURIER" />}
      <main className="list">
        {sortedOrders.length === 0 ? <div className="empty">Готовых доставок нет</div> : sortedOrders.map((order) => {
          const unread = !seenIds.has(order.id);
          return (
            <article className={`order-row${unread ? " is-new" : ""}`} key={order.id} onClick={() => markSeen(order.id)}>
              <OrderAvatar order={order} unread={unread} />
              <div className="order-main">
                <div className="order-top">
                  <div className="order-title">
                    <strong>Заказ #{order.public_number}</strong>
                    <span>{courierTimeText(order)}</span>
                  </div>
                  <div className="order-side">
                    <span className={unread ? "new-badge" : "read-badge"}>{unread ? "Новый" : "Прочитано"}</span>
                    <Menu order={order} />
                  </div>
                </div>
                <div className="order-meta-line">
                  <CustomerBadge order={order} />
                  <span className="payment-chip">{paymentText(order)}</span>
                </div>
                <div className="address-compact">
                  <MapPin size={18} />
                  <span>{order.address || "Адрес не указан"}</span>
                </div>
                {order.phone ? (
                  <a
                    className="phone-compact"
                    href={`tel:${order.phone}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Phone size={18} />
                    <span>{order.phone}</span>
                  </a>
                ) : (
                  <div className="phone-compact is-disabled">
                    <Phone size={18} />
                    <span>Телефон не указан</span>
                  </div>
                )}
                <ul className="items-compact" aria-label={`Состав заказа #${order.public_number}`}>
                  {order.items.map((item, index) => (
                    <li key={`${item.menu_item_id}-${index}`}>
                      <b>{item.quantity}×</b>
                      <span>{item.snapshot_title}</span>
                    </li>
                  ))}
                </ul>
                <div className="courier-footer">
                  <div className="cash-compact">{order.payment_method === "cash" ? money(order.total_minor) : "ОПЛАЧЕН"}</div>
                  <button
                    className="primary compact-action"
                    disabled={busy === order.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void markDelivered(order);
                    }}
                  >
                    <Check size={20} /> ДОСТАВЛЕНО
                  </button>
                </div>
                <div className="eta compact-eta" onClick={(event) => event.stopPropagation()}>
                  <span>Сообщить ETA:</span>
                  <div>
                    {[5, 10, 15, 20].map((minutes) => (
                      <button
                        key={minutes}
                        disabled={etaBusy === `${order.id}:${minutes}`}
                        title={courierEtaLink(order, minutes) ? "Открыть ЛС с готовым сообщением" : "У клиента нет username, отправим через bot"}
                        onClick={() => void sendETA(order, minutes)}
                      >
                        {minutes} мин
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </main>
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />}
    </div>
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
  const phone = order.phone?.trim();
  const address = order.address?.trim();
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
          {phone ? <a href={`tel:${phone}`}>Позвонить</a> : <span>Телефон не указан</span>}
          {address ? (
            <>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(address)}><Copy size={16} /> Скопировать адрес</button>
              <a href={mapLink(address)} target="_blank" rel="noreferrer">Открыть карту</a>
            </>
          ) : (
            <span>Адрес не указан</span>
          )}
          <a href={problemLink(order)} target="_blank" rel="noreferrer">Проблема с доставкой</a>
        </div>
      )}
    </div>
  );
}

function secondsAgo(value: Date) {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
}

function staffActionErrorText(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "ORDER_STATUS_CONFLICT") return "Заказ уже изменился. Экран обновлён, проверьте актуальный статус.";
  if (code === "IDEMPOTENCY_CONFLICT") return "Действие уже отправляется. Подождите и обновите экран.";
  if (code === "RATE_LIMITED") return "Слишком много запросов. Подождите минуту и попробуйте ещё раз.";
  if (code === "FORBIDDEN" || code === "AUTH_INVALID") return "Сессия устарела или нет доступа. Откройте Mini App заново из Telegram.";
  return "Действие не выполнено. Экран обновлён, попробуйте ещё раз.";
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
