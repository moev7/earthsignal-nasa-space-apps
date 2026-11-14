import {
  RADAR_STUDY_ID,
  type RadarCell,
  type RadarRegion,
} from "./public-radar-study";
import type { CatalogQuery } from "@/features/catalog/domain";

/** Registry-owned identity/dates. Public selections never identify a private job. */
export const PUBLIC_RADAR_STUDY = {
  id: RADAR_STUDY_ID,
  beforeId:
    "NISAR_L2_PR_GCOV_024_005_A_020_4005_DHDH_A_20260626T125220_20260626T125255_P05023_N_F_J_001",
  afterId:
    "NISAR_L2_PR_GCOV_032_005_A_020_4005_DHDH_A_20260930T125217_20260930T125252_P05023_N_F_J_001",
  title: "Lake Mead radar study",
  start: "2026-06-26",
  end: "2026-09-30",
  bbox: [-114.75, 36.05, -114.74, 36.06] as [number, number, number, number],
  width: 94,
  height: 114,
};
export type PublicStudySelection = RadarCell | RadarRegion;
export type PublicStudyContext = {
  id: typeof RADAR_STUDY_ID;
  selection: PublicStudySelection | null;
};
function parseSelection(value: string): PublicStudySelection | null {
  if (
    !/^(?:cell:\d{1,3},\d{1,3}|region:\d{1,3},\d{1,3},\d{1,3},\d{1,3})$/.test(
      value,
    )
  )
    return null;
  const [kind, coordinates] = value.split(":"),
    n = coordinates.split(",").map(Number);
  if (kind === "cell") {
    const [row, column] = n;
    return row < 114 && column < 94 ? { row, column } : null;
  }
  const [left, top, right, bottom] = n;
  return left <= right && top <= bottom && right < 94 && bottom < 114
    ? { left, top, right, bottom }
    : null;
}
function serialize(selection: PublicStudySelection) {
  return "row" in selection
    ? `cell:${selection.row},${selection.column}`
    : `region:${selection.left},${selection.top},${selection.right},${selection.bottom}`;
}
export function readPublicStudyContext(
  params: URLSearchParams,
): PublicStudyContext | null {
  if (
    params.getAll("study").length !== 1 ||
    params.get("study") !== RADAR_STUDY_ID ||
    params.getAll("selection").length > 1
  )
    return null;
  const raw = params.get("selection");
  const selection = raw === null ? null : parseSelection(raw);
  if (raw !== null && !selection) return null;
  return { id: RADAR_STUDY_ID, selection };
}
export function publicStudyQuery(selection?: PublicStudySelection | null) {
  const p = new URLSearchParams({ study: RADAR_STUDY_ID });
  if (selection) {
    const raw = serialize(selection);
    if (!parseSelection(raw)) throw new Error("Invalid public radar selection");
    p.set("selection", raw);
  }
  return p.toString();
}
export function publicStudyWorkspaceHref(
  selection?: PublicStudySelection | null,
) {
  return `/workspace?${publicStudyQuery(selection)}`;
}
export function publicStudyExploreHref(
  selection?: PublicStudySelection | null,
) {
  return `/explore?${publicStudyQuery(selection)}`;
}
export function publicStudySignInHref(context: PublicStudyContext) {
  return `/sign-in?continue=workspace-study&${publicStudyQuery(context.selection)}`;
}
export function publicStudyCatalogQuery(): CatalogQuery {
  return {
    region: "mead",
    product: "GCOV",
    start: PUBLIC_RADAR_STUDY.start,
    end: PUBLIC_RADAR_STUDY.end,
  };
}

/** Inverse WGS84 / UTM zone11 north, limited to the pinned Lake Mead grid. */
function nativeCorner(column: number, row: number): [number, number] {
  const easting = 702640 + 10 * column,
    northing = 3992970 - 10 * row;
  const a = 6378137,
    e2 = 0.0066943799901413165,
    k = 0.9996,
    ep = e2 / (1 - e2),
    e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu =
    northing /
    k /
    (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi),
    c = Math.cos(phi),
    t = Math.tan(phi),
    N = a / Math.sqrt(1 - e2 * s * s),
    R = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5,
    T = t * t,
    C = ep * c * c,
    D = (easting - 500000) / (N * k);
  const lat =
    phi -
    ((N * t) / R) *
      ((D * D) / 2 -
        ((5 + 3 * T + 10 * C - 4 * C * C - 9 * ep) * D ** 4) / 24 +
        ((61 + 90 * T + 298 * C + 45 * T * T - 252 * ep - 3 * C * C) * D ** 6) /
          720);
  const lon =
    (-117 * Math.PI) / 180 +
    (D -
      ((1 + 2 * T + C) * D ** 3) / 6 +
      ((5 - 2 * C + 28 * T - 3 * C * C + 8 * ep + 24 * T * T) * D ** 5) / 120) /
      c;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
/** Full native cell boundaries; not an interpolated lon/lat image box. */
export function publicStudyArea(context: PublicStudyContext): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const s = context.selection;
  if (!s) {
    const [w, south, e, n] = PUBLIC_RADAR_STUDY.bbox;
    return {
      type: "Polygon" as const,
      coordinates: [
        [
          [w, south],
          [e, south],
          [e, n],
          [w, n],
          [w, south],
        ],
      ],
    };
  }
  const r =
    "row" in s
      ? { left: s.column, right: s.column, top: s.row, bottom: s.row }
      : s;
  const nw = nativeCorner(r.left, r.top),
    ne = nativeCorner(r.right + 1, r.top),
    se = nativeCorner(r.right + 1, r.bottom + 1),
    sw = nativeCorner(r.left, r.bottom + 1);
  return { type: "Polygon" as const, coordinates: [[nw, ne, se, sw, nw]] };
}
export function publicStudySelectionLabel(
  selection: PublicStudySelection | null,
) {
  return !selection
    ? "the study footprint"
    : "row" in selection
      ? `native cell ${selection.row + 1}, ${selection.column + 1}`
      : `native rows ${selection.top + 1}–${selection.bottom + 1}, columns ${selection.left + 1}–${selection.right + 1}`;
}

/** The engine accepts a geographic box; keep the native polygon in the investigation draft. */
export function publicStudyRadarRequest(context: PublicStudyContext) {
  const points = publicStudyArea(context).coordinates[0];
  const bbox: [number, number, number, number] = context.selection
    ? [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ]
    : [...PUBLIC_RADAR_STUDY.bbox];
  return {
    beforeId: PUBLIC_RADAR_STUDY.beforeId,
    afterId: PUBLIC_RADAR_STUDY.afterId,
    bbox,
  };
}
