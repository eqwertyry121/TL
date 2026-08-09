const statusEl = document.getElementById("telegram-status");
const webApp = window.Telegram && window.Telegram.WebApp;

if (webApp) {
  webApp.ready();
  webApp.expand();
  statusEl.textContent = "Открыто внутри Telegram Mini App";
} else {
  statusEl.textContent = "Открыто в обычном браузере. В Telegram будет Mini App режим.";
  statusEl.classList.add("off");
}
