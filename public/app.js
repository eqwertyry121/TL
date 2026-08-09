const OWNER_TELEGRAM_ID = 1048084234;
const MAX_QTY = 99;
const DELIVERY_FEE = 0;
const STORAGE_KEY = "tako-lako-demo-v1";

const menu = [
  {
    id: "khinkali-classic",
    category: "Хинкали",
    name: "Классические хинкали",
    description: "Замороженные хинкали с говядиной и зеленью. Минимум 5 шт",
    price: 690,
    weight: "от 5 шт",
    allergen: "",
    art: ["#be123c", "#f97316"],
  },
  {
    id: "khinkali-cheese",
    category: "Хинкали",
    name: "Хинкали без кинзы",
    description: "Замороженные хинкали с говядиной без кинзы. Минимум 5 шт",
    price: 640,
    weight: "от 5 шт",
    allergen: "",
    art: ["#047857", "#84cc16"],
  },
  {
    id: "khachapuri-adjarian",
    category: "Хачапури",
    name: "Аджарский хачапури",
    description: "Лодочка с сыром, яйцом и сливочным маслом",
    price: 890,
    weight: "1 шт",
    allergen: "",
    art: ["#9a3412", "#facc15"],
  },
  {
    id: "khachapuri-imeretian",
    category: "Хачапури",
    name: "Имеретинский хачапури",
    description: "Круглый хачапури с сыром внутри",
    price: 760,
    weight: "1 шт",
    allergen: "",
    art: ["#7c2d12", "#fb923c"],
  },
  {
    id: "chakhokhbili",
    category: "Горячее",
    name: "Чахохбили",
    description: "Курица в томатном соусе с травами",
    price: 940,
    weight: "350 г",
    allergen: "",
    art: ["#991b1b", "#ef4444"],
  },
  {
    id: "lobio",
    category: "Горячее",
    name: "Лобио",
    description: "Фасоль с орехами, зеленью и специями",
    price: 620,
    weight: "300 г",
    allergen: "",
    art: ["#365314", "#65a30d"],
  },
  {
    id: "lemonade-tarragon",
    category: "Напитки",
    name: "Лимонад тархун",
    description: "Холодный газированный лимонад",
    price: 290,
    weight: "500 мл",
    allergen: "",
    art: ["#166534", "#22c55e"],
  },
  {
    id: "berry-mors",
    category: "Напитки",
    name: "Морс ягодный",
    description: "Домашний ягодный напиток",
    price: 260,
    weight: "400 мл",
    allergen: "",
    art: ["#7f1d1d", "#db2777"],
  },
];

const initialState = {
  role: "CLIENT",
  manualDayOff: false,
  cart: {},
  orders: [],
  profile: {
    phone: "+381 60 000 0000",
    address: "Bulevar Kralja Aleksandra 100, stan 12",
    comment: "",
  },
  hiddenItems: {},
};

let state = loadState();

const app = document.getElementById("app");
const webApp = window.Telegram && window.Telegram.WebApp;
if (webApp) {
  webApp.ready();
  webApp.expand();
}

function loadState() {
  try {
    return { ...initialState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...initialState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return `${value.toLocaleString("ru-RU")} RSD`;
}

function visibleMenu() {
  return menu.filter((item) => !state.hiddenItems[item.id]);
}

function cartLines() {
  return Object.entries(state.cart)
    .map(([id, qty]) => ({ item: menu.find((entry) => entry.id === id), qty }))
    .filter((line) => line.item && line.qty > 0 && !state.hiddenItems[line.item.id]);
}

function cartSubtotal() {
  return cartLines().reduce((sum, line) => sum + line.item.price * line.qty, 0);
}

function isScheduleOpen() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Belgrade",
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday").value;
  const hour = Number(parts.find((part) => part.type === "hour").value);
  return weekday !== "Mon" && hour >= 13 && hour < 21;
}

function canAcceptOrders() {
  return !state.manualDayOff && isScheduleOpen();
}

function setRole(role) {
  state.role = role;
  saveState();
  render();
}

function setQty(id, nextQty) {
  const qty = Math.max(0, Math.min(MAX_QTY, nextQty));
  state.cart[id] = qty;
  if (qty === 0) delete state.cart[id];
  saveState();
  render();
}

function createOrder() {
  if (!canAcceptOrders() || cartLines().length === 0) return;
  const orderNo = 100 + state.orders.length + 1;
  const lines = cartLines().map((line) => ({
    id: line.item.id,
    name: line.item.name,
    qty: line.qty,
    price: line.item.price,
  }));
  const subtotal = cartSubtotal();
  state.orders.unshift({
    id: crypto.randomUUID(),
    number: orderNo,
    status: "NEW",
    createdAt: new Date().toISOString(),
    readyAt: null,
    deliveredAt: null,
    phone: state.profile.phone,
    address: state.profile.address,
    comment: state.profile.comment,
    items: lines,
    subtotal,
    total: subtotal + DELIVERY_FEE,
    paymentMethod: "cash",
  });
  state.cart = {};
  state.profile.comment = "";
  saveState();
  render();
}

function markReady(id) {
  state.orders = state.orders.map((order) =>
    order.id === id && order.status === "NEW"
      ? { ...order, status: "OUT_FOR_DELIVERY", readyAt: new Date().toISOString() }
      : order,
  );
  saveState();
  render();
}

function markDelivered(id) {
  state.orders = state.orders.map((order) =>
    order.id === id && order.status === "OUT_FOR_DELIVERY"
      ? { ...order, status: "DELIVERED", deliveredAt: new Date().toISOString() }
      : order,
  );
  saveState();
  render();
}

function toggleHiddenItem(id) {
  state.hiddenItems[id] = !state.hiddenItems[id];
  if (!state.hiddenItems[id]) delete state.hiddenItems[id];
  saveState();
  render();
}

function resetDemo() {
  state = { ...initialState, profile: { ...initialState.profile } };
  saveState();
  render();
}

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statusLabel(status) {
  return {
    NEW: "Заказ принят, готовится",
    OUT_FOR_DELIVERY: "Заказ в доставке",
    DELIVERED: "Заказ доставлен",
    CANCELLED: "Заказ отменён",
  }[status];
}

function shell(content) {
  const tgUser = webApp && webApp.initDataUnsafe && webApp.initDataUnsafe.user;
  const userLabel = tgUser ? `TG ${tgUser.id}` : `local owner ${OWNER_TELEGRAM_ID}`;
  const banner = canAcceptOrders() ? "" : '<div class="banner">ВЫХОДНОЙ · новые заказы закрыты</div>';
  return `
    <div class="app">
      <header class="topbar">
        <div class="brand-row">
          <div class="brand">
            <h1>Tako Lako</h1>
            <p>Local Mini App prototype · ${userLabel}</p>
          </div>
          <span class="pill ${canAcceptOrders() ? "" : "muted"}">
            ${canAcceptOrders() ? "Принимаем заказы" : "Checkout закрыт"}
          </span>
        </div>
        ${banner}
        <nav class="tabs" aria-label="Роли">
          ${["CLIENT", "KITCHEN", "COURIER", "ADMIN"]
            .map((role) => `<button class="tab ${state.role === role ? "active" : ""}" data-role="${role}">${role}</button>`)
            .join("")}
        </nav>
      </header>
      ${content}
    </div>
  `;
}

function renderClient() {
  const lines = cartLines();
  const subtotal = cartSubtotal();
  const total = subtotal;
  const latestOrder = state.orders[0];
  const categories = [...new Set(visibleMenu().map((item) => item.category))];

  return `
    <section class="grid">
      ${latestOrder ? renderOrder(latestOrder, "client") : ""}
      ${categories
        .map(
          (category) => `
            <div>
              <h2 class="section-title">${category}</h2>
              <div class="menu-grid">
                ${visibleMenu()
                  .filter((item) => item.category === category)
                  .map(renderMenuItem)
                  .join("")}
              </div>
            </div>
          `,
        )
        .join("")}
      <div class="cart-bar">
        <div class="row">
          <strong>Корзина: ${lines.reduce((sum, line) => sum + line.qty, 0)} поз.</strong>
          <span class="price">${money(total)}</span>
        </div>
        <div class="two-col">
          <div class="field">
            <label>Телефон</label>
            <input data-field="phone" value="${escapeAttr(state.profile.phone)}" />
          </div>
          <div class="field">
            <label>Адрес</label>
            <input data-field="address" value="${escapeAttr(state.profile.address)}" />
          </div>
        </div>
        <div class="field">
          <label>Комментарий к заказу</label>
          <textarea data-field="comment" maxlength="300">${escapeHtml(state.profile.comment)}</textarea>
        </div>
        <button class="primary" data-create-order ${!canAcceptOrders() || !lines.length ? "disabled" : ""}>
          Оформить cash-заказ · ${money(total)}
        </button>
      </div>
    </section>
  `;
}

function renderMenuItem(item) {
  const qty = state.cart[item.id] || 0;
  return `
    <article class="card">
      <div class="food-art" style="--art-a:${item.art[0]}; --art-b:${item.art[1]}">${initials(item.name)}</div>
      <div class="card-body grid">
        <div>
          <div class="row">
            <h2>${item.name}</h2>
            <span class="price">${money(item.price)}</span>
          </div>
          <p>${item.description}</p>
          <p class="meta">${item.weight}</p>
        </div>
        <div class="row">
          <div class="qty">
            <button data-qty-minus="${item.id}">-</button>
            <span>${qty}</span>
            <button data-qty-plus="${item.id}">+</button>
          </div>
          <button class="secondary" data-qty-plus="${item.id}">Добавить</button>
        </div>
      </div>
    </article>
  `;
}

function renderKitchen() {
  const orders = state.orders.filter((order) => order.status === "NEW");
  return `
    <section class="grid">
      <h2 class="section-title">НОВЫЕ ЗАКАЗЫ</h2>
      <div class="list">
        ${orders.length ? orders.map((order) => renderOrder(order, "kitchen")).join("") : '<div class="empty">Новых заказов нет</div>'}
      </div>
    </section>
  `;
}

function renderCourier() {
  const orders = state.orders.filter((order) => order.status === "OUT_FOR_DELIVERY");
  return `
    <section class="grid">
      <h2 class="section-title">ДОСТАВКИ</h2>
      <div class="list">
        ${orders.length ? orders.map((order) => renderOrder(order, "courier")).join("") : '<div class="empty">Готовых доставок нет</div>'}
      </div>
    </section>
  `;
}

function renderAdmin() {
  const delivered = state.orders.filter((order) => order.status === "DELIVERED");
  const revenue = delivered.reduce((sum, order) => sum + order.total, 0);
  return `
    <section class="grid">
      <div class="panel grid">
        <h2>Admin</h2>
        <div class="switch-row">
          <div>
            <strong>Остановить приём заказов</strong>
            <p>Клиентам показывается красная плашка ВЫХОДНОЙ, существующие заказы не отменяются.</p>
          </div>
          <button class="toggle ${state.manualDayOff ? "on" : ""}" data-toggle-day-off aria-label="Остановить приём заказов"></button>
        </div>
      </div>
      <div class="two-col">
        <div class="stat"><span class="meta">Всего заказов</span><strong>${state.orders.length}</strong></div>
        <div class="stat"><span class="meta">Выручка delivered</span><strong>${money(revenue)}</strong></div>
      </div>
      <div class="panel grid">
        <h2>Menu visibility</h2>
        ${menu
          .map(
            (item) => `
              <div class="switch-row">
                <div>
                  <strong>${item.name}</strong>
                  <p>${money(item.price)} · ${state.hiddenItems[item.id] ? "скрыто" : "видимо"}</p>
                </div>
                <button class="ghost" data-toggle-item="${item.id}">
                  ${state.hiddenItems[item.id] ? "Показать" : "Скрыть"}
                </button>
              </div>
            `,
          )
          .join("")}
      </div>
      <button class="danger" data-reset-demo>Сбросить demo-данные</button>
    </section>
  `;
}

function renderOrder(order, mode) {
  const hidePii = mode === "kitchen";
  const actions = {
    client: "",
    kitchen: `<button class="primary" data-ready="${order.id}">ЗАКАЗ ГОТОВ</button>`,
    courier: `<button class="primary" data-delivered="${order.id}">ДОСТАВЛЕНО</button>`,
  }[mode];

  return `
    <article class="order-card">
      <div class="order-head">
        <div>
          <div class="order-no">Заказ #${order.number}</div>
          <div class="meta">${statusLabel(order.status)} · ${new Date(order.createdAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}</div>
        </div>
        <span class="pill muted">${money(order.total)}</span>
      </div>
      <ul class="items">
        ${order.items.map((item) => `<li><span>${item.qty} x ${item.name}</span><strong>${money(item.qty * item.price)}</strong></li>`).join("")}
      </ul>
      ${order.comment ? `<p><strong>Комментарий:</strong> ${escapeHtml(order.comment)}</p>` : ""}
      ${hidePii ? "" : `<p><strong>Адрес:</strong> ${escapeHtml(order.address)}</p><p><strong>Телефон:</strong> ${escapeHtml(order.phone)}</p>`}
      ${actions}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function render() {
  const views = {
    CLIENT: renderClient,
    KITCHEN: renderKitchen,
    COURIER: renderCourier,
    ADMIN: renderAdmin,
  };
  app.innerHTML = shell(views[state.role]());
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.role) setRole(target.dataset.role);
  if (target.dataset.qtyPlus) setQty(target.dataset.qtyPlus, (state.cart[target.dataset.qtyPlus] || 0) + 1);
  if (target.dataset.qtyMinus) setQty(target.dataset.qtyMinus, (state.cart[target.dataset.qtyMinus] || 0) - 1);
  if (target.dataset.createOrder !== undefined) createOrder();
  if (target.dataset.ready) markReady(target.dataset.ready);
  if (target.dataset.delivered) markDelivered(target.dataset.delivered);
  if (target.dataset.toggleDayOff !== undefined) {
    state.manualDayOff = !state.manualDayOff;
    saveState();
    render();
  }
  if (target.dataset.toggleItem) toggleHiddenItem(target.dataset.toggleItem);
  if (target.dataset.resetDemo !== undefined) resetDemo();
});

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  state.profile[field] = event.target.value;
  saveState();
});

render();
