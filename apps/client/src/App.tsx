import type { MenuItem, Order, Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Minus,
  Phone,
  Plus,
  ReceiptText,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi } from "./api";
import { orderStatusText } from "./fixtures";
import { t } from "./i18n";
import { maskPhone, money } from "./money";
import { currentRoute, navigate, replaceRoute, routeToHash } from "./route";
import {
  clearCart,
  loadCart,
  loadCheckoutDraft,
  loadLocale,
  pendingIdempotencyKey,
  resetPendingIdempotencyKey,
  saveCart,
  saveCheckoutDraft,
  saveLocale,
  upsertCartLine,
} from "./storage";
import { haptic, initialLocale, requestTelegramContact, syncBackButton } from "./telegram";
import type { Api, AppData, Calculation, CartLine, CartState, CheckoutDraft, Locale, Route, Session } from "./types";

const api = createApi();

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [locale, setLocale] = useState<Locale>(() => loadLocale(initialLocale()));
  const [cart, setCart] = useState<CartState>(loadCart);
  const [draft, setDraft] = useState<CheckoutDraft>(loadCheckoutDraft);
  const [data, setData] = useState<AppData>({ session: null, runtime: null, categories: [], orders: [] });
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const token = data.session?.token || "";
  const items = useMemo(() => data.categories.flatMap((category) => category.items), [data.categories]);
  const itemLookup = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const cartLines = useMemo(() => Object.values(cart.lines), [cart.lines]);
  const availableCartLines = useMemo(() => cartLines.filter((line) => itemLookup.has(line.itemId)), [cartLines, itemLookup]);
  const cartQuantity = availableCartLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = availableCartLines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  const total = subtotal;
  const checkoutOpen = Boolean(data.runtime?.accepting_orders);
  const dayOffBlocked = isDayOffRuntime(data.runtime) && !isOwnerTelegramId(data.session?.telegram_user_id);

  const refresh = useCallback(async () => {
    setError("");
    const session = data.session || (await api.authenticate(locale));
    const [runtime, menu, orders] = await Promise.all([api.runtime(), api.menu(locale), api.listOrders(session.token).catch(() => ({ orders: [] }))]);
    setData({ session, runtime, categories: menu.categories, orders: orders.orders });
    return session;
  }, [data.session, locale]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    refresh()
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refresh]);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => syncBackButton(route, () => window.history.back()), [route]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  useEffect(() => {
    document.body.classList.toggle("has-day-off-overlay", dayOffBlocked);
    return () => document.body.classList.remove("has-day-off-overlay");
  }, [dayOffBlocked]);

  useEffect(() => {
    if (route.name !== "order" || !token) return;
    let stopped = false;
    const load = async () => {
      try {
        const order = await api.getOrder(token, route.id);
        if (!stopped) mergeOrder(order);
      } catch {
        if (!stopped) setError("Не удалось обновить статус заказа");
      }
    };
    void load();
    const timer = window.setInterval(load, 10000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [route, token]);

  function updateLocale(next: Locale) {
    setLocale(next);
    saveLocale(next);
    setData((current) => ({ ...current, session: null }));
  }

  function setLine(item: MenuItem, quantity: number) {
    const minQuantity = itemMinQuantity(item);
    const nextQuantity = quantity <= 0 ? 0 : Math.max(minQuantity, Math.min(99, quantity));
    const line: CartLine = {
      itemId: item.id,
      title: item.title,
      unitPriceMinor: item.price_minor,
      quantity: nextQuantity,
      menuVersion: item.version,
      updatedAt: new Date().toISOString(),
    };
    const next = upsertCartLine(cart, line);
    setCart(next);
    saveCart(next);
    setCalculation(null);
    haptic();
  }

  function removeCartLine(itemId: string) {
    const nextLines = { ...cart.lines };
    delete nextLines[itemId];
    const next = { version: 1, lines: nextLines } satisfies CartState;
    setCart(next);
    saveCart(next);
    setCalculation(null);
    haptic();
  }

  useEffect(() => {
    if (itemLookup.size === 0) return;
    let changed = false;
    let hasUnavailableLine = false;
    const nextLines = { ...cart.lines };
    for (const line of Object.values(nextLines)) {
      const item = itemLookup.get(line.itemId);
      if (!item) {
        hasUnavailableLine = true;
        continue;
      }
      const minQuantity = itemMinQuantity(item);
      const quantity = line.quantity > 0 && line.quantity < minQuantity ? minQuantity : line.quantity;
      if (quantity !== line.quantity || line.title !== item.title || line.unitPriceMinor !== item.price_minor || line.menuVersion !== item.version) {
        nextLines[line.itemId] = {
          ...line,
          title: item.title,
          unitPriceMinor: item.price_minor,
          quantity,
          menuVersion: item.version,
          updatedAt: new Date().toISOString(),
        };
        changed = true;
      }
    }
    if (hasUnavailableLine) setCalculation(null);
    if (!changed) return;
    const next = { version: 1, lines: nextLines } satisfies CartState;
    setCart(next);
    saveCart(next);
    setCalculation(null);
  }, [cart.lines, itemLookup]);

  function updateDraft(patch: Partial<CheckoutDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveCheckoutDraft(next);
  }

  async function calculate() {
    if (!token || availableCartLines.length === 0) return null;
    const result = await api.calculate(
      token,
      availableCartLines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
    );
    setCalculation(result);
    return result;
  }

  async function submitOrder() {
    if (!token || submitting) return;
    if (!draft.phone.trim() || !draft.street.trim()) {
      setError("Поделитесь телефоном через Telegram и заполните адрес");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const calc = calculation || (await calculate());
      if (!calc) throw new Error("EMPTY_CART");
      const order = await api.createOrder(
        token,
        {
          calculation_token: calc.calculation_token,
          phone: draft.phone.trim(),
          address: [draft.street, draft.details].filter(Boolean).join(", "),
          comment: draft.comment.trim(),
          payment_method: "cash",
          terms_accepted: true,
          locale,
        },
        pendingIdempotencyKey(),
      );
      clearCart();
      resetPendingIdempotencyKey();
      setCart(loadCart());
      setCalculation(null);
      mergeOrder(order);
      replaceRoute({ name: "order", id: order.id });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  function mergeOrder(order: Order) {
    setData((current) => ({
      ...current,
      orders: [order, ...current.orders.filter((entry) => entry.id !== order.id)],
    }));
  }

  if (loading && !data.runtime) {
    return <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={0} header="Tako Lako - Грузинская кухня"><div className="state">Загрузка...</div></Shell>;
  }

  const content =
    route.name === "dish" ? (
      <Dish item={itemLookup.get(route.id)} line={cart.lines[route.id]} onSetLine={setLine} locale={locale} />
    ) : route.name === "cart" ? (
      <Cart lines={cartLines} itemLookup={itemLookup} subtotal={subtotal} total={total} checkoutOpen={checkoutOpen} locale={locale} onSetLine={setLine} onRemoveLine={removeCartLine} />
    ) : route.name === "checkout" ? (
      <Checkout
        lines={availableCartLines}
        draft={draft}
        calculation={calculation}
        subtotal={subtotal}
        total={total}
        checkoutOpen={checkoutOpen}
        locale={locale}
        submitting={submitting}
        onDraft={updateDraft}
        onCalculate={calculate}
        onSubmit={submitOrder}
      />
    ) : route.name === "order" ? (
      <OrderScreen order={data.orders.find((order) => order.id === route.id)} locale={locale} />
    ) : route.name === "orders" ? (
      <Orders orders={data.orders} locale={locale} />
    ) : route.name === "support" ? (
      <Support support={data.runtime?.support_text || "@Tako_Lako"} />
    ) : route.name === "terms" ? (
      <Terms />
    ) : (
      <Menu categories={data.categories} cart={cart} onSetLine={setLine} />
    );

  return (
    <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={cartQuantity} header="Tako Lako - Грузинская кухня" runtime={data.runtime} session={data.session}>
      {error && (
        <div className="notice error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {content}
      {cartQuantity > 0 && route.name !== "checkout" && route.name !== "cart" && (
        <button className="cart-float" onClick={() => navigate({ name: "cart" })}>
          <ShoppingCart size={18} />
          <span>{cartQuantity}</span>
          <strong>{money(total)}</strong>
        </button>
      )}
    </Shell>
  );
}

function Shell({
  children,
  locale,
  route,
  header,
  cartQuantity,
  runtime,
  session,
  onLocale,
}: {
  children: React.ReactNode;
  locale: Locale;
  route: Route;
  header: string;
  cartQuantity: number;
  runtime?: AppData["runtime"];
  session?: Session | null;
  onLocale: (locale: Locale) => void;
}) {
  const isRoot = route.name === "menu";
  const dayOffBlocked = isDayOffRuntime(runtime) && !isOwnerTelegramId(session?.telegram_user_id);
  const showClosedBanner = runtime && !runtime.accepting_orders && !dayOffBlocked;

  return (
    <div className={dayOffBlocked ? "app-shell is-day-off-blocked" : "app-shell"}>
      <header className="app-header">
        <div className="top-row">
          <div className="header-main">
            {!isRoot && (
              <button className="icon-button" onClick={() => window.history.back()} aria-label="Назад">
                <ArrowLeft size={20} />
              </button>
            )}
            {isRoot && <span className="brand-mark" aria-hidden="true">TL</span>}
            <div className="brand">
              <strong>{header}</strong>
              <span className="worktime" aria-label="Приём заказов с 13:00 до 21:00">
                <span>Заказы</span>
                <strong>13:00–21:00</strong>
              </span>
            </div>
          </div>
          <div className="header-actions">
            <ProfileBadge session={session} />
            {isRoot && (
              <div className="locale">
                {(["ru", "sr", "en"] as Locale[]).map((entry) => (
                  <button key={entry} className={entry === locale ? "active" : ""} onClick={() => onLocale(entry)}>
                    {entry.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showClosedBanner && <div className="closed-banner">{t(locale, "checkoutClosed")}</div>}
        <nav className="nav">
          <a className={route.name === "menu" ? "active" : ""} href="#/">
            {t(locale, "menu")}
          </a>
          <a className={route.name === "cart" ? "active" : ""} href="#/cart">
            {t(locale, "cart")}{cartQuantity ? ` · ${cartQuantity}` : ""}
          </a>
          <a className={route.name === "orders" ? "active" : ""} href="#/orders">
            {t(locale, "orders")}
          </a>
          <a className={route.name === "support" ? "active" : ""} href="#/support">
            {t(locale, "support")}
          </a>
        </nav>
        {isOwnerTelegramId(session?.telegram_user_id) && <OwnerRoleSwitch activeRole="CLIENT" />}
      </header>
      <main className="app-content" aria-hidden={dayOffBlocked ? "true" : undefined}>{children}</main>
      {dayOffBlocked && <DayOffOverlay locale={locale} runtime={runtime} />}
    </div>
  );
}

function DayOffOverlay({ locale, runtime }: { locale: Locale; runtime?: AppData["runtime"] }) {
  const nextOpening = formatNextOpening(runtime?.next_opening, locale);
  const title = dayOffTitle(runtime, locale);

  return (
    <div className="day-off-overlay" role="dialog" aria-modal="true" aria-labelledby="day-off-title">
      <section className="day-off-card">
        <span className="day-off-kicker">Tako Lako</span>
        <h1 id="day-off-title">{title}</h1>
        <p>{t(locale, "dayOffMessage")}</p>
        {nextOpening && (
          <small>
            {t(locale, "nextOpening")}: <strong>{nextOpening}</strong>
          </small>
        )}
      </section>
    </div>
  );
}

function ProfileBadge({ session }: { session?: Session | null }) {
  if (!session?.telegram_user_id) return null;
  const label = profileLabel(session);
  const initials = profileInitials(session);
  return (
    <div className="profile-badge" title={label}>
      <span className="profile-avatar">
        <span>{initials}</span>
        {session.photo_url && <img src={session.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <span>{label}</span>
    </div>
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

function Menu({ categories, cart, onSetLine }: { categories: AppData["categories"]; cart: CartState; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const flatItems = categories.flatMap((category, categoryIndex) => category.items.map((item, index) => ({ item, visualIndex: categoryIndex + index })));
  return (
    <div className="page">
      <section className="menu-section">
        <div className="menu-grid">
          {flatItems.map(({ item, visualIndex }) => {
            const qty = cart.lines[item.id]?.quantity || 0;
            const minQuantity = itemMinQuantity(item);
            return (
              <article className={qty > 0 ? "dish-card in-cart" : "dish-card"} key={item.id}>
                <button className={`dish-art art-${visualIndex % 6}`} onClick={() => navigate({ name: "dish", id: item.id })}>
                  <span className="dish-emoji">{foodVisual(item.title)}</span>
                  <small className="dish-badge">{item.weight_text}</small>
                </button>
                <div className="dish-body">
                  <button className="link-title" onClick={() => navigate({ name: "dish", id: item.id })}>
                    {item.title}
                  </button>
                  <p>{item.description}</p>
                  <div className="meta-row">
                    <span>{item.weight_text}</span>
                    <strong>{money(item.price_minor)}</strong>
                  </div>
                  <div className="row-actions">
                    {qty > 0 ? (
                      <Qty value={qty} onMinus={() => onSetLine(item, qty <= minQuantity ? 0 : qty - 1)} onPlus={() => onSetLine(item, qty + 1)} />
                    ) : (
                      <button className="primary add-only" onClick={() => onSetLine(item, minQuantity)}>
                        В корзину{minQuantity > 1 ? ` · ${minQuantity} шт` : ""}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
function Dish({ item, line, locale, onSetLine }: { item?: MenuItem; line?: CartLine; locale: Locale; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const [qty, setQty] = useState(line?.quantity || (item ? itemMinQuantity(item) : 1));
  if (!item) return <div className="state">Блюдо не найдено</div>;
  const minQuantity = itemMinQuantity(item);
  return (
    <div className="page narrow dish-page">
      <div className="hero-art art-2">
        <span className="dish-emoji">{foodVisual(item.title)}</span>
        <small className="dish-badge">{item.weight_text}</small>
      </div>
      <span className="eyebrow">Tako Lako special</span>
      <h1>{item.title}</h1>
      <p className="lead">{item.description}</p>
      <div className="panel-list">
        <div className="split">
          <span>{item.weight_text}</span>
          <strong>{money(item.price_minor)}</strong>
        </div>
      </div>
      <div className="bottom-action">
        <Qty value={qty} onMinus={() => setQty(Math.max(minQuantity, qty - 1))} onPlus={() => setQty(Math.min(99, qty + 1))} />
        <button className="primary" onClick={() => {
          onSetLine(item, qty);
          navigate({ name: "cart" });
        }}>
          {t(locale, "add")} · {money(item.price_minor * qty)}
        </button>
      </div>
    </div>
  );
}

function Cart({
  lines,
  itemLookup,
  subtotal,
  total,
  checkoutOpen,
  locale,
  onSetLine,
  onRemoveLine,
}: {
  lines: CartLine[];
  itemLookup: Map<string, MenuItem>;
  subtotal: number;
  total: number;
  checkoutOpen: boolean;
  locale: Locale;
  onSetLine: (item: MenuItem, quantity: number) => void;
  onRemoveLine: (itemId: string) => void;
}) {
  if (!lines.length) return <div className="state">{t(locale, "emptyCart")}</div>;
  const hasAvailableLines = lines.some((line) => itemLookup.has(line.itemId));
  return (
    <div className="page narrow cart-page">
      <h1>{t(locale, "cart")}</h1>
      <div className="list">
        {lines.map((line) => {
          const item = itemLookup.get(line.itemId);
          const isUnavailable = !item;
          return (
            <div className={isUnavailable ? "line unavailable-line" : "line"} key={line.itemId}>
              <div>
                <strong>{line.title}</strong>
                <span>{isUnavailable ? `0 × ${money(0)}` : `${line.quantity} × ${money(line.unitPriceMinor)}`}</span>
                {isUnavailable && <span className="danger-text">Блюдо недоступно</span>}
              </div>
              {item ? (
                <Qty value={line.quantity} onMinus={() => onSetLine(item, line.quantity <= itemMinQuantity(item) ? 0 : line.quantity - 1)} onPlus={() => onSetLine(item, line.quantity + 1)} />
              ) : (
                <button className="trash-button" type="button" aria-label="Удалить недоступное блюдо" onClick={() => onRemoveLine(line.itemId)}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Totals subtotal={subtotal} total={total} locale={locale} />
      <button className="primary full" disabled={!checkoutOpen || !hasAvailableLines} onClick={() => navigate({ name: "checkout" })}>
        {!checkoutOpen ? t(locale, "checkoutClosed") : hasAvailableLines ? `${t(locale, "goCheckout")} · ${money(total)}` : t(locale, "noAvailableItems")}
      </button>
    </div>
  );
}

function Checkout({
  lines,
  draft,
  calculation,
  subtotal,
  total,
  checkoutOpen,
  locale,
  submitting,
  onDraft,
  onCalculate,
  onSubmit,
}: {
  lines: CartLine[];
  draft: CheckoutDraft;
  calculation: Calculation | null;
  subtotal: number;
  total: number;
  checkoutOpen: boolean;
  locale: Locale;
  submitting: boolean;
  onDraft: (patch: Partial<CheckoutDraft>) => void;
  onCalculate: () => Promise<Calculation | null>;
  onSubmit: () => Promise<void>;
}) {
  useEffect(() => {
    if (lines.length) void onCalculate().catch(() => undefined);
  }, [lines.length]);
  if (!lines.length) return <div className="state">{t(locale, "emptyCart")}</div>;
  return (
    <div className="page narrow checkout-page">
      <h1>{t(locale, "checkout")}</h1>
      <div className="form">
        <button className={draft.phone ? "contact-share active-contact" : "contact-share"} onClick={async () => {
          const phone = await requestTelegramContact();
          if (phone) onDraft({ phone });
        }}>
          <Phone size={18} />
          {draft.phone ? `Телефон получен: ${maskPhone(draft.phone)}` : "Поделиться телефоном для связи"}
        </button>
        <label>
          <span>{t(locale, "street")}</span>
          <input value={draft.street} maxLength={120} onChange={(event) => onDraft({ street: event.target.value })} />
        </label>
        <label>
          <span>{t(locale, "details")}</span>
          <input value={draft.details} maxLength={120} onChange={(event) => onDraft({ details: event.target.value })} />
        </label>
        <label>
          <span>{t(locale, "comment")}</span>
          <textarea value={draft.comment} maxLength={300} onChange={(event) => onDraft({ comment: event.target.value })} />
        </label>
      </div>
      <div className="notice">
        <AlertCircle size={18} />
        <span>{t(locale, "addressWarning")}</span>
      </div>
      <Totals subtotal={calculation?.subtotal_minor || subtotal} total={calculation?.subtotal_minor || total} locale={locale} />
      <button className="primary full" disabled={!checkoutOpen || submitting} onClick={onSubmit}>
        {submitting ? "..." : `${t(locale, "placeOrder")} · ${money(calculation?.subtotal_minor || total)}`}
      </button>
    </div>
  );
}

function OrderScreen({ order, locale }: { order?: Order; locale: Locale }) {
  if (!order) return <div className="state">Заказ не найден</div>;
  return (
    <div className="page narrow order-page">
      <div className="order-status">
        <Check size={22} />
        <div>
          <h1>#{order.public_number}</h1>
          <p>{localizedStatus(order, locale)}</p>
        </div>
      </div>
      <div className="list">
        {order.items.map((item) => (
          <div className="line" key={item.menu_item_id}>
            <div>
              <strong>{item.quantity} × {item.snapshot_title}</strong>
              <span>{money(item.line_total_minor)}</span>
            </div>
          </div>
        ))}
      </div>
      <Totals subtotal={order.subtotal_minor} total={order.subtotal_minor} locale={locale} />
      <div className="panel-list">
        <div className="split"><span>{t(locale, "phone")}</span><strong>{maskPhone(order.phone)}</strong></div>
        <div className="split"><span>{t(locale, "cash")}</span><strong>{order.payment_status === "PAID" ? "PAID" : "CASH"}</strong></div>
      </div>
      <button className="secondary full" onClick={() => navigate({ name: "support" })}>{t(locale, "support")}</button>
    </div>
  );
}

function Orders({ orders, locale }: { orders: Order[]; locale: Locale }) {
  if (!orders.length) return <div className="state">{t(locale, "orders")} пустая</div>;
  return (
    <div className="page narrow">
      <h1>{t(locale, "orders")}</h1>
      <div className="list">
        {orders.map((order) => (
          <button className="history-line" key={order.id} onClick={() => navigate({ name: "order", id: order.id })}>
            <ReceiptText size={20} />
            <span>#{order.public_number}<small>{localizedStatus(order, locale)}</small></span>
            <strong>{money(order.total_minor)}</strong>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Support({ support }: { support: string }) {
  const handle = support.replace("@", "") || "Tako_Lako";
  return (
    <div className="page narrow">
      <h1>Поддержка</h1>
      <p className="lead">По любому вопросу по заказу напишите менеджеру напрямую в Telegram.</p>
      <a className="primary full as-link" href={`https://t.me/${handle}`}>Написать менеджеру @{handle}</a>
    </div>
  );
}

function Terms() {
  return (
    <div className="page narrow">
      <h1>Условия доставки</h1>
      <p className="lead">Доставка оформляется по текстовому адресу клиента. Проверьте телефон и адрес перед отправкой заказа. Оплата в MVP производится наличными курьеру.</p>
    </div>
  );
}

function Qty({ value, onMinus, onPlus }: { value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="qty">
      <button onClick={onMinus} aria-label="Минус"><Minus size={16} /></button>
      <span>{value}</span>
      <button onClick={onPlus} aria-label="Плюс"><Plus size={16} /></button>
    </div>
  );
}

function Totals({ subtotal, total, locale }: { subtotal: number; total: number; locale: Locale }) {
  if (subtotal === total) {
    return (
      <div className="totals single-total">
        <div><span>{t(locale, "total")}</span><strong>{money(total)}</strong></div>
      </div>
    );
  }
  return (
    <div className="totals">
      <div><span>{t(locale, "subtotal")}</span><strong>{money(subtotal)}</strong></div>
      <div><span>{t(locale, "total")}</span><strong>{money(total)}</strong></div>
    </div>
  );
}

function localizedStatus(order: Order, locale: Locale): string {
  if (locale === "ru") return orderStatusText(order);
  if (order.fulfillment_status === "NEW") return t(locale, "accepted");
  if (order.fulfillment_status === "OUT_FOR_DELIVERY") return t(locale, "delivery");
  if (order.fulfillment_status === "DELIVERED") return t(locale, "delivered");
  return t(locale, "cancelled");
}

function foodVisual(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("хинкали")) return "🥟";
  if (lower.includes("хачапури")) return "🧀";
  if (lower.includes("чахохбили")) return "🍗";
  if (lower.includes("лобио")) return "🍲";
  if (lower.includes("лимонад")) return "🥤";
  if (lower.includes("морс")) return "🍓";
  return "🍽️";
}

function itemMinQuantity(item: MenuItem): number {
  return Math.max(1, item.min_quantity || 1);
}

function isDayOffRuntime(runtime?: AppData["runtime"]): boolean {
  return Boolean(runtime && !runtime.accepting_orders && (runtime.reason === "manual_day_off" || runtime.reason === "weekly_day_off"));
}

function formatNextOpening(value: string | undefined, locale: Locale): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localeCode = locale === "sr" ? "sr-Latn-RS" : locale === "en" ? "en-US" : "ru-RU";
  return new Intl.DateTimeFormat(localeCode, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dayOffTitle(runtime: AppData["runtime"] | undefined, locale: Locale): string {
  const title = (runtime?.day_off_banner || "").trim();
  if (!title || /^\?+$/.test(title)) return t(locale, "closed");
  return title;
}

function profileLabel(profile: Pick<Session, "telegram_user_id" | "username" | "first_name">): string {
  const username = (profile.username || "").trim();
  if (username) return username.startsWith("@") ? username : `@${username}`;
  const firstName = (profile.first_name || "").trim();
  if (firstName) return firstName;
  return `TG ${profile.telegram_user_id}`;
}

function profileInitials(profile: Pick<Session, "username" | "first_name">): string {
  const source = (profile.first_name || profile.username || "TG").trim();
  return source.slice(0, 2).toUpperCase();
}

function errorText(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : String((err as Error)?.message || err);
  switch (code) {
    case "MANUAL_DAY_OFF":
      return "Сегодня выходной";
    case "RESTAURANT_CLOSED":
      return "Сейчас заказы не принимаются";
    case "ITEM_UNAVAILABLE":
      return "Одно из блюд недоступно";
    case "INVALID_QUANTITY":
      return "Проверьте количество блюд";
    case "EMPTY_CART":
      return "В корзине нет доступных блюд";
    case "IDEMPOTENCY_CONFLICT":
      return "Заказ уже отправляется. Проверьте статус";
    case "AUTH_INVALID":
      return "Telegram авторизация не прошла";
    case "INVALID_INPUT":
      return "Поделитесь телефоном через Telegram и заполните адрес";
    default:
      return "Сервер недоступен. Попробуйте ещё раз";
  }
}
