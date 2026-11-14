import type { ValueGrid } from '@/features/ground-truth/data/nisar';

export type GroundPoint = { lat: number; lng: number };
export type GroundLine = { start: GroundPoint; end: GroundPoint };
export type GroundProfileView = { line: GroundLine; point: GroundPoint };
export type GroundSegment = {
  from: number; to: number; cell: number | null; rate: number | null; sigma: number | null;
  point: GroundPoint;
};
export const pointOnLine = (line: GroundLine, t: number): GroundPoint => ({
  lat: line.start.lat + (line.end.lat - line.start.lat) * t,
  lng: line.start.lng + (line.end.lng - line.start.lng) * t,
});
export function defaultGroundLine(grid: ValueGrid): GroundLine {
  const lat = grid.north - grid.rows * grid.dlat * .62;
  return { start: { lat, lng: grid.west + grid.cols * grid.dlon * .05 }, end: { lat, lng: grid.west + grid.cols * grid.dlon * .95 } };
}
/** Approximate spherical endpoint distance; this is a display-grid probe, not a new native analysis. */
export function groundLineKm(line: GroundLine): number {
  const rad = Math.PI / 180, a = line.start, b = line.end;
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
/** Intersect a straight lon/lat line with grid boundaries: one segment per crossed cell, no interpolation. */
export function groundProfile(grid: ValueGrid, line: GroundLine): GroundSegment[] {
  if (![grid.west, grid.north, grid.dlon, grid.dlat, line.start.lat, line.start.lng, line.end.lat, line.end.lng].every(Number.isFinite)
    || grid.dlon <= 0 || grid.dlat <= 0 || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols)
    || grid.rows <= 0 || grid.cols <= 0 || grid.rows + grid.cols > 20000
    || Math.abs(line.start.lat) > 90 || Math.abs(line.end.lat) > 90 || Math.abs(line.start.lng) > 180 || Math.abs(line.end.lng) > 180
    || groundLineKm(line) < .001) return [];
  const dx = line.end.lng-line.start.lng, dy = line.end.lat-line.start.lat;
  const cuts = [0, 1];
  const add = (t: number) => { if (t > 0 && t < 1) cuts.push(t); };
  if (dx) for (let i=0; i<=grid.cols; i++) add((grid.west+i*grid.dlon-line.start.lng)/dx);
  if (dy) for (let j=0; j<=grid.rows; j++) add((grid.north-j*grid.dlat-line.start.lat)/dy);
  const edges = cuts.sort((a,b)=>a-b).filter((t,i,a)=>i===0 || t-a[i-1]>1e-10);
  return edges.slice(0,-1).map((from,i) => {
    const to = edges[i+1], point = pointOnLine(line,(from+to)/2);
    const col = Math.floor((point.lng-grid.west)/grid.dlon), row = Math.floor((grid.north-point.lat)/grid.dlat);
    const cell = col>=0 && row>=0 && col<grid.cols && row<grid.rows ? row*grid.cols+col : null;
    const value = cell===null ? null : grid.vertical_rate[cell];
    const rate = typeof value==='number' && Number.isFinite(value) ? value : null;
    const error = cell===null ? null : grid.vertical_sigma[cell];
    const sigma = rate!==null && typeof error==='number' && Number.isFinite(error) && error>=0 ? error : null;
    return { from, to, cell, rate, sigma, point };
  });
}
/** A conditional fixed-rate offset in metres. Null support remains null, even at year zero. */
export function groundOffset(rate: number | null, years: number): number | null {
  if(rate===null || !Number.isFinite(rate) || !Number.isFinite(years) || years<0)return null;
  const offset=rate*years/1000;
  return Number.isFinite(offset) ? offset===0?0:offset : null;
}
