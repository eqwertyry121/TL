import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canOpenCityLocationSettings, cityLocationHelpCopy, openCityLocationSettings } from "./city-location";

export function CityLocationHelp({ locale, onConfirm }: { locale: string; onConfirm: () => Promise<void> }) {
  const copy = cityLocationHelpCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const [open, setOpen] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!waiting || !open) return;
    const app = window.Telegram?.WebApp;
    const manager = app?.LocationManager;
    let finished = false;
    const check = () => {
      if (finished || document.hidden || app?.isActive === false || !manager?.isAccessGranted) return;
      finished = true;
      setWaiting(false);
      // Permission alone is not verification: obtain a fix and let the server check it.
      void confirm.current();
    };
    const resume = () => {
      if (finished || document.hidden || app?.isActive === false) return;
      try { manager?.init(check); } catch { /* A tap can retry on older clients. */ }
      check();
    };
    app?.onEvent?.("locationManagerUpdated", check);
    app?.onEvent?.("activated", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    // Read only the SDK permission flag; never poll GPS or open permission prompts.
    const poll = window.setInterval(check, 500);
    const timeout = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      setWaiting(false);
      setFailed(true);
    }, 60000);
    check();
    return () => {
      finished = true;
      clearInterval(poll);
      clearTimeout(timeout);
      app?.offEvent?.("locationManagerUpdated", check);
      app?.offEvent?.("activated", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [waiting, open]);

  const allow = () => {
    if (waiting) return;
    setFailed(false);
    const manager = window.Telegram?.WebApp?.LocationManager;
    if (canOpenCityLocationSettings(manager)) {
      setWaiting(true);
      // Must stay synchronous with this tap (Telegram requires a user gesture).
      if (!openCityLocationSettings(manager)) {
        setWaiting(false);
        setFailed(true);
      }
    } else {
      void confirm.current();
    }
  };
  const close = () => { setWaiting(false); setOpen(false); setFailed(false); };

  return <>
    <button className="primary full" type="button" onClick={() => setOpen(true)}>{copy.permissionButton}</button>
    {open && createPortal(<dialog ref={dialog} className="city-permission-dialog" aria-labelledby="city-permission-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <button className="city-permission-close" type="button" aria-label={copy.close} onClick={close}>×</button>
      <div className="city-permission-content">
        <h2 id="city-permission-title">{copy.permissionTitle}</h2>
        <p role="status">{failed ? copy.permissionFailed : waiting ? copy.permissionWaiting : copy.permissionDescription}</p>
        <button className="primary full city-permission-allow" type="button" disabled={waiting} onClick={allow}>
          {copy.permissionButton}
        </button>
      </div>
    </dialog>, document.body)}
  </>;
}
