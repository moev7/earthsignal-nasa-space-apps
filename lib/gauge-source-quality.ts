import type { GaugeVintage } from "./gauge-vintage-contract";

export type GaugeSnapshot = Extract<GaugeVintage, { status: "captured" }>["snapshot"];

export type GaugeQualitySummary = {
  records: number;
  numericRecords: number;
  nullRecords: number;
  missingDays: number;
  qualifiedRecords: number;
  approvalCounts: { label: string; records: number }[];
  flagCounts: { label: string; records: number }[];
};

/** Caller supplies a validated full snapshot, never compact metadata or unparsed source JSON. */
export function summarizeGaugeQuality(snapshot: GaugeSnapshot): GaugeQualitySummary {
  let numericRecords = 0;
  let nullRecords = 0;
  let qualifiedRecords = 0;

  const approvalMap = new Map<string, number>();
  const flagMap = new Map<string, number>();

  const observations = snapshot.observations;
  const records = observations.length;
  const missingDays = snapshot.unknownDays;

  for (const obs of observations) {
    if (typeof obs.value === "number" && Number.isFinite(obs.value)) {
      numericRecords += 1;
    } else if (obs.value === null) {
      nullRecords += 1;
    }

    if (typeof obs.quality === "string") {
      approvalMap.set(obs.quality, (approvalMap.get(obs.quality) ?? 0) + 1);
    }

    if (Array.isArray(obs.qualifiers) && obs.qualifiers.length > 0) {
      const distinctFlags = new Set(obs.qualifiers);
      if (distinctFlags.size > 0) {
        qualifiedRecords += 1;
        for (const flag of distinctFlags) {
          flagMap.set(flag, (flagMap.get(flag) ?? 0) + 1);
        }
      }
    }
  }

  function sortCounts(map: Map<string, number>): { label: string; records: number }[] {
    return Array.from(map.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        return 0;
      })
      .map(([label, recs]) => ({ label, records: recs }));
  }

  return {
    records,
    numericRecords,
    nullRecords,
    missingDays,
    qualifiedRecords,
    approvalCounts: sortCounts(approvalMap),
    flagCounts: sortCounts(flagMap),
  };
}
