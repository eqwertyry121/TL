import React from "react";
import { createRoot } from "react-dom/client";
import { OWNER_TELEGRAM_ID, telegramMiniAppUserID } from "@tk-delivery/api-client/role-switch";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const accessAllowed = import.meta.env.VITE_APP_ENV !== "test" || telegramMiniAppUserID() === OWNER_TELEGRAM_ID;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {accessAllowed ? <ErrorBoundary><App /></ErrorBoundary> : <main className="portal-page"><section className="portal-card"><h1>Доступ закрыт</h1></section></main>}
  </React.StrictMode>,
);
