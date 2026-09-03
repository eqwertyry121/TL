import { useEffect, useRef, useState } from "react";
import { canOpenCityLocationSettings, cityLocationHelpCopy, openCityLocationSettings } from "./city-location";
import { Icon } from "./Icon";

// A motion illustration, not a recording or an interactive permission dialog.
// The real permission action below uses Telegram's native settings API.
export function CityLocationHelp({ locale, confirmLabel, onConfirm }: { locale: string; confirmLabel: string; onConfirm: () => Promise<void> }) {
  const copy = cityLocationHelpCopy(locale);
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [ended, setEnded] = useState(false);
  const [staticFrame, setStaticFrame] = useState(false);
  const [manual, setManual] = useState(false);
  const manager = window.Telegram?.WebApp?.LocationManager;
  const settingsAvailable = !manual && canOpenCityLocationSettings(manager);
  const running = playing && visible && foreground && !reducedMotion;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { setReducedMotion(media.matches); if (media.matches) setPlaying(false); };
    const visibility = () => setForeground(!document.hidden);
    media.addEventListener("change", changed);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5), { threshold: 0.5 });
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (step < 2) setStep(step + 1);
      else { setPlaying(false); setEnded(true); }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  const selectStep = (next: number) => { setStep(next); setPlaying(false); setEnded(false); setStaticFrame(true); };
  const openSettings = () => {
    setPlaying(false);
    setStaticFrame(true);
    if (openCityLocationSettings(manager)) setStep(1);
    else { setManual(true); setStep(0); }
  };

  return <section ref={root} className={`city-location-help ${running ? "is-playing" : "is-paused"} ${staticFrame ? "is-static" : ""}`} aria-label={copy.title}>
    <header className="city-guide-heading">
      <span className="city-guide-symbol"><Icon name="location" size={23} /></span>
      <h3>{copy.title}</h3>
      <p>{copy.subtitle}</p>
    </header>
    <div className={`city-guide-stage city-guide-stage-${step}`} key={step} aria-hidden="true">
      {step === 0 ? <div className="city-guide-chat">
        <div className="city-guide-chat-header">
          <Icon name="arrow-left" size={20} />
          <span className="city-guide-avatar">TL</span>
          <span className="city-guide-bot-name">TL_main<small>{copy.botLabel}</small></span>
          <Icon name="more" size={20} />
          <span className="city-guide-touch" />
        </div>
        <div className="city-guide-chat-body"><i /><i /><i /></div>
      </div> : step === 1 ? <div className="city-guide-permission">
        <div className="city-guide-profile"><span className="city-guide-avatar">TL</span><span>TL_main</span></div>
        <small>{copy.allow}</small>
        <div className="city-guide-setting-row">
          <span className="city-guide-location-icon"><Icon name="location" size={21} /></span>
          <span>{copy.location}<small>Geolocation</small></span>
          <span className="city-guide-switch"><i /></span>
          <span className="city-guide-touch" />
        </div>
      </div> : <div className="city-guide-return">
        <span className="city-guide-return-icon"><Icon name="arrow-left" size={26} /></span>
        <span className="city-guide-return-brand">Tako Lako</span>
        <div className="city-guide-return-button"><Icon name="location" size={18} />{copy.confirm}</div>
        <span className="city-guide-touch" />
      </div>}
    </div>
    <div className="city-guide-caption" aria-live={playing ? "off" : "polite"}>
      <span className="city-guide-step-label">{copy.step} {step + 1} / 3</span>
      <h4>{copy.titles[step]}</h4>
      <p>{copy.steps[step]}</p>
    </div>
    <nav className="city-guide-controls" aria-label={copy.title}>
      <div className="city-guide-steps">{copy.titles.map((title, index) => <button
        key={title} type="button" aria-label={`${copy.step} ${index + 1}: ${title}`} aria-current={step === index ? "step" : undefined}
        onClick={() => selectStep(index)}><span /></button>)}</div>
      {!reducedMotion && <button className="city-guide-play" type="button" onClick={() => {
        setStaticFrame(false);
        if (ended) { setStep(0); setEnded(false); setPlaying(true); }
        else setPlaying(!playing);
      }}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        {playing ? <path d="M3 2h3v12H3zm7 0h3v12h-3z" /> : <path d="M4 2v12l10-6z" />}
      </svg>{ended ? copy.replay : playing ? copy.pause : copy.play}</button>}
    </nav>
    {settingsAvailable && step !== 2 && <button className="primary full city-guide-settings" type="button" onClick={openSettings}>
      {copy.settings}<Icon name="chevron-right" size={18} />
    </button>}
    {manual && <p className="city-guide-manual" role="status">{copy.manual}</p>}
    <button data-location-confirm className={`${settingsAvailable && step !== 2 ? "secondary" : "primary"} full city-guide-confirm`} type="button" onClick={() => void onConfirm()}>{confirmLabel}</button>
  </section>;
}
