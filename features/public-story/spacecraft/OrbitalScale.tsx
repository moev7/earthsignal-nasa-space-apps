const EARTH_RADIUS_KM = 6371;
export const NISAR_ALTITUDE_KM = 747;
export const ORBIT_RADIUS_RATIO = (EARTH_RADIUS_KM + NISAR_ALTITUDE_KM) / EARTH_RADIUS_KM;

/** Distance geometry, separate from the metre-scale hardware inspector. */
export function OrbitalScale() {
  const id = useId();
  const [angle, setAngle] = useState(270);
  const earth = 140, orbit = earth * ORBIT_RADIUS_RATIO;
  const radians = angle * Math.PI / 180;
  const x = 220 + orbit * Math.cos(radians), y = 185 + orbit * Math.sin(radians);
  return <figure className="es-orbital-scale">
    <svg viewBox="0 0 440 370" role="img" aria-label="NISAR orbits 747 kilometres above Earth. Earth’s mean radius is 6,371 kilometres. The orbit and Earth are drawn at the same distance scale; the locator is enlarged.">
      <circle cx="220" cy="185" r={orbit} fill="none" stroke="#8bcec0" strokeWidth="1" strokeDasharray="4 5" />
      <circle cx="220" cy="185" r={earth} fill="#183a40" stroke="#578078" />
      <line x1="220" y1="185" x2="360" y2="185" stroke="#b5c9c3" />
      <text x="230" y="176" fill="#eeeae1" fontSize="13">Earth radius · 6,371 km</text>
      <line x1="220" y1={185 - earth} x2="220" y2={185 - orbit} stroke="#ffc272" strokeWidth="2" />
      <circle data-orbit-locator cx={x} cy={y} r="4" fill="#ffc272" />
      <path d={`M226 ${185 - orbit} H300 V18`} fill="none" stroke="#ffc272" />
      <text x="306" y="22" fill="#ffc272" fontSize="13">747 km above</text>
      <text x="220" y="240" textAnchor="middle" fill="#b5c9c3" fontSize="13">The spacecraft is too small</text>
      <text x="220" y="260" textAnchor="middle" fill="#b5c9c3" fontSize="13">to see at this scale.</text>
    </svg>
    <figcaption><label htmlFor={`${id}-angle`}>Move the locator around the orbit<input id={`${id}-angle`} type="range" min="0" max="360" value={angle} onChange={event => setAngle(Number(event.target.value))} /></label><a href="https://science.nasa.gov/mission/nisar/mission-overview/">NASA: NISAR’s orbit</a> · distance diagram, not a live position. The orbital plane is simplified.</figcaption>
  </figure>;
}
import { useId, useState } from 'react';

