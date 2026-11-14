import type {
  CaseCity,
  MetricPoint,
  TimelineEvent,
} from "@/features/ground-truth/data/types";

export const CITY_COLORS: Record<CaseCity["id"], string> = {
  tehran: "#8bcec0",
  tokyo: "#d2b4ec",
};

export const EVENT_META: Record<
  TimelineEvent["kind"],
  { label: string; color: string }
> = {
  cause: { label: "Cause", color: "#edaa93" },
  observation: { label: "Observation", color: "#99c9e8" },
  policy: { label: "Policy", color: "#d2b4ec" },
  impact: { label: "Impact", color: "#e6c47e" },
  recovery: { label: "Recovery", color: "#8bcec0" },
};

export function trendYears(cities: CaseCity[]): number[] {
  return [
    ...new Set(cities.flatMap((city) => city.trend.map((point) => point.year))),
  ].sort((a, b) => a - b);
}

/** Exact source point only: missing years are never interpolated into readings. */
export function pointAtYear(
  city: CaseCity,
  year: number,
): MetricPoint | undefined {
  return city.trend.find((point) => point.year === year);
}

export function illustrationBand(point: MetricPoint): {
  low: number;
  high: number;
} {
  const magnitude = Math.abs(point.rateMmPerYear);
  return {
    low: Math.max(0, magnitude - point.uncertainty),
    high: magnitude + point.uncertainty,
  };
}

export function nearestYear(years: number[], target: number): number {
  return years.reduce(
    (nearest, year) =>
      Math.abs(year - target) < Math.abs(nearest - target) ? year : nearest,
    years[0],
  );
}

export interface Milestone {
  key: string;
  city: CaseCity;
  event: TimelineEvent;
}

/** Source index disambiguates, for example, Tokyo's two distinct 1962 events. */
export function milestones(cities: CaseCity[]): Milestone[] {
  return cities
    .flatMap((city) =>
      city.timeline.map((event, index) => ({
        key: `${city.id}-${index}`,
        city,
        event,
      })),
    )
    .sort((a, b) => a.event.year - b.event.year);
}

export function latestMilestone(
  events: Milestone[],
  year: number,
  preferredKey?: string,
): Milestone | undefined {
  const reached = events.filter((item) => item.event.year <= year);
  const last = reached.at(-1);
  const preferred = reached.find((item) => item.key === preferredKey);
  return preferred && preferred.event.year === last?.event.year
    ? preferred
    : last;
}
