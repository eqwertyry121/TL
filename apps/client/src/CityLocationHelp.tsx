import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canOpenCityLocationSettings, cityLocationHelpCopy, openCityLocationSettings, type CityLocationFailure } from "./city-location";
import locationOff from "./assets/location-permission-off.png";
import locationOn from "./assets/location-permission-on.png";

export function CityLocationHelp({ locale, onConfirm, busy, failure }: { locale: string; onConfirm: () => Promise<void>; busy: boolean; failure: CityLocationFailure | null }) {
  const copy = cityLocationHelpCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!waiting) return;
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
  }, [waiting]);

  const allow = () => {
    if (waiting || busy) return;
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
  return createPortal(<dialog ref={dialog} className="city-permission-dialog" aria-labelledby="city-permission-title"
      onCancel={(event) => event.preventDefault()}>
      <div className="city-permission-content">
        <h2 id="city-permission-title">{copy.permissionTitle}</h2>
        <p role="status">{busy ? copy.checking : failed ? copy.permissionFailed : waiting ? copy.permissionWaiting : failure && failure !== "denied" ? copy.messages[failure] : copy.permissionDescription}</p>
        {(!failure || failure === "denied") && <div className="city-permission-examples">
          <figure><figcaption>{copy.off}</figcaption><div className="city-permission-crop"><img src={locationOff} width="1079" height="1783" alt={copy.offAlt} /></div></figure>
          <figure><figcaption>{copy.on}</figcaption><div className="city-permission-crop is-on"><img src={locationOn} width="1073" height="1722" alt={copy.onAlt} /></div></figure>
        </div>}
        <button className="primary full city-permission-allow" type="button" disabled={waiting || busy} onClick={allow}>
          {copy.permissionButton}
        </button>
        <a className="city-permission-support" href="https://t.me/eqwertyry" target="_blank" rel="noopener noreferrer" onClick={(event) => {
          const app = window.Telegram?.WebApp;
          if (app?.openTelegramLink) { event.preventDefault(); app.openTelegramLink("https://t.me/eqwertyry"); }
        }}>{copy.support} <span>@eqwertyry</span></a>
      </div>
    </dialog>, document.body);
}
