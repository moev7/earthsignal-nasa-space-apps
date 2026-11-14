/** Synthetic, zero-baseline repeat-pass model. All physical lengths are metres.
 * Far-field LOS is fixed at 35° from vertical; phase is positive for increasing
 * range (away from radar). This teaching convention is not a mission sign rule.
 * https://science.nasa.gov/mission/nisar/interferometry/
 * https://hyp3-docs.asf.alaska.edu/guides/insar_product_guide/
 */
export const RADAR = Object.freeze({ wavelengthM: 0.24, incidenceDeg: 35, radiusM: 120, altitudeM: 700_000 });
export type Metres3 = readonly [number, number, number]; // x, up, z
const angle = RADAR.incidenceDeg * Math.PI / 180;
export const TOWARD_RADAR: Metres3 = [-Math.sin(angle), Math.cos(angle), 0];
export const SATELLITE_M: Metres3 = [-RADAR.altitudeM * Math.tan(angle), RADAR.altitudeM, 0];
export const PHASE_STOPS = ['#42d4c5', '#5165e8', '#b85cdb', '#f0a15c', '#e5e984', '#42d4c5'] as const;
export const DEPTH_STOPS = ['#dbece6', '#72a9b5', '#4b549a'] as const;
export const MAX_SINKING_M = 0.3;
export const RADAR_SITES = [
  { id: 'centre', label: 'Centre', xM: 0, zM: 0 },
  { id: 'slope', label: 'Slope', xM: 60, zM: 0 },
  { id: 'edge', label: 'Stable edge', xM: 120, zM: 0 },
] as const;
export type RadarSiteId = typeof RADAR_SITES[number]['id'];
export type RadarColourMode = 'phase' | 'depth';
const rgb = (stops: readonly string[]) => stops.map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255));
const rgbStops = rgb(PHASE_STOPS);
const depthStops = rgb(DEPTH_STOPS);
const interpolate = (stops: number[][], fraction: number): [number, number, number] => {
  const position = fraction * (stops.length - 1);
  const low = Math.min(Math.floor(position), stops.length - 2), t = position - low;
  return stops[low].map((value, i) => value + (stops[low + 1][i] - value) * t) as [number, number, number];
};

export function radarSite(id: RadarSiteId) {
  return RADAR_SITES.find(site => site.id === id) ?? RADAR_SITES[0];
}

/** Compact smooth bowl: zero displacement and zero slope at the reference edge. */
export function bowlWeight(xM: number, zM: number): number {
  const r2 = (xM * xM + zM * zM) / (RADAR.radiusM * RADAR.radiusM);
  return Math.max(0, 1 - r2) ** 3;
}
export function phaseFromRange(deltaRangeM: number, wavelengthM: number = RADAR.wavelengthM) {
  if (!(wavelengthM > 0) || !Number.isFinite(wavelengthM) || !Number.isFinite(deltaRangeM)) throw new RangeError('Finite range and positive wavelength required');
  const cycles = 2 * deltaRangeM / wavelengthM;
  const wrappedCycles = ((cycles % 1) + 1) % 1;
  return { deltaRangeM, cycles, radians: 2 * Math.PI * cycles, wrappedCycles };
}
export function rangeFromDisplacement(displacementM: Metres3): number {
  const projected = -displacementM.reduce((sum, value, i) => sum + value * TOWARD_RADAR[i], 0);
  return projected === 0 ? 0 : projected;
}
export function radarSample(xM: number, zM: number, sinkingM: number) {
  const downM = Math.max(0, sinkingM) * bowlWeight(xM, zM);
  const beforeM: Metres3 = [xM, 0, zM];
  const afterM: Metres3 = [xM, downM === 0 ? 0 : -downM, zM];
  return { beforeM, afterM, downM, ...phaseFromRange(rangeFromDisplacement([0, -downM, 0])) };
}
/** Cyclic colour interpolation shared by the surface vertices and HTML swatch. */
export function phaseColour(cycles: number): [number, number, number] {
  const phase = ((cycles % 1) + 1) % 1;
  return interpolate(rgbStops, phase);
}
/** Fixed vertical-depth scale, independent of peak sinking and sample selection. */
export function depthColour(downM: number): [number, number, number] {
  return interpolate(depthStops, Math.max(0, Math.min(1, downM / MAX_SINKING_M)));
}
export function surfaceColour(sample: ReturnType<typeof radarSample>, mode: RadarColourMode): [number, number, number] {
  return mode === 'depth' ? depthColour(sample.downM) : phaseColour(sample.cycles);
}
/** Display-only transform. Never pass exaggerated coordinates into the model. */
export function displayPoint(pointM: Metres3, verticalExaggeration = 240): [number, number, number] {
  return [pointM[0] / 30, pointM[1] * verticalExaggeration / 30, pointM[2] / 30];
}
