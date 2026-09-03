import { useState } from "react";
import { cityLocationHelpCopy } from "./city-location";
import locationOff from "./assets/location-permission-off.png";
import locationOn from "./assets/location-permission-on.png";

// Original user-provided screenshots, cropped in CSS, not a simulated OS dialog.
export function CityLocationHelp({ locale }: { locale: string }) {
  const [replay, setReplay] = useState(0);
  const copy = cityLocationHelpCopy(locale);
  return <section className="city-location-help" aria-label={copy.title}>
    <ol>{copy.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    <figure>
      <div className="city-location-demo" key={replay} aria-hidden="true">
        <img className="city-location-demo-off" src={locationOff} alt="" width="1079" height="1783" />
        <img className="city-location-demo-on" src={locationOn} alt="" width="1073" height="1722" />
      </div>
      <figcaption>{copy.example}</figcaption>
    </figure>
    <button className="city-location-replay" type="button" onClick={() => setReplay((value) => value + 1)}>{copy.replay}</button>
  </section>;
}
