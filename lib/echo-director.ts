import { z } from "zod";
import { radarSample } from "./radar-interferometry";

const n = z.number().finite();
/** Only scalar public experiment state. No chat, workspace, geometry or uploaded data. */
export const echoTelemetrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("water"),
      depletion: n.min(0).max(1),
      compacted: n.min(0).max(1),
      returned: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("season"),
      season: n.int().min(0).max(4),
      storage: n.min(0).max(100),
      compacted: n.min(0).max(1),
      deficit: n.min(0).max(100),
      balanced: n.int().min(0).max(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal("street"),
      westCm: n.min(0).max(30),
      eastCm: n.min(0).max(30),
    })
    .strict(),
  z
    .object({
      kind: z.literal("radar"),
      xM: n.min(0).max(120),
      zM: n.min(-120).max(120),
      sinkingM: n.min(0).max(0.3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ground"),
      lat: n.min(-90).max(90),
      lng: n.min(-180).max(180),
      rate: n.nullable(),
      sigma: n.nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("backscatter"),
      row: n.int().nonnegative(),
      column: n.int().nonnegative(),
      differenceDb: n.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("footprint"),
      osmId: n.int().nonnegative(),
      tilt: n.nonnegative().nullable(),
      sigma: n.nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("policy"),
      actionStep: n.min(0).max(20),
      reduction: n.min(0).max(1),
      total: n.min(0).max(20),
    })
    .strict(),
]);
export type EchoTelemetry = z.infer<typeof echoTelemetrySchema>;
export type EchoReading = {
  id: string;
  text: string;
  stamp: string;
  target: string;
  lines: string[];
};
const fixed = (v: number, d = 1) => v.toFixed(d);

/** Authored reactions to exact state; this engine never calls a model or a server. */
export function directEcho(input: unknown): EchoReading {
  const parsed = echoTelemetrySchema.safeParse(input);
  if (!parsed.success)
    return {
      id: "unavailable",
      text: "That instrument has no verified reading yet. Try another point.",
      stamp: "Unavailable",
      target: "",
      lines: ["Reading unavailable; no value substituted."],
    };
  const t = parsed.data;
  switch (t.kind) {
    case "water":
      return {
        id: t.returned
          ? "water-return"
          : t.depletion > 0.7
            ? "water-drawn"
            : "water-open",
        text: t.returned
          ? "The water came back. Some space did not. The dashed street line remembers what was lost."
          : t.depletion > 0.7
            ? "Now bring the water back. Will the street rise with it?"
            : t.depletion > 0
              ? "Watch the thin layer squeeze as water pressure falls."
              : "Take water out. Keep your eye on the street, not just the blue.",
        stamp: "Illustration",
        target: '[data-affordance="water"]',
        lines: [
          `${fixed((1 - t.depletion) * 100, 0)}% illustrative water remaining`,
          `${fixed(t.compacted * 100, 0)}% authored compaction pose · not a measured strain`,
        ],
      };
    case "season":
      return {
        id: `season-${t.season}-${t.deficit > 0 ? "short" : t.compacted > 0 ? "locked" : "balanced"}`,
        text:
          t.season === 0
            ? "Four dry seasons. Can you keep the taps running without mining the ground?"
            : t.deficit > 0
              ? `The city is short by ${fixed(t.deficit, 0)} game units. Try connecting another supply before opening the pump.`
              : t.compacted > 0
                ? "The taps ran, but you squeezed the fine layer. Recharging the water cannot erase that loss. Try a fresh route."
                : `Demand met. ${t.balanced} season${t.balanced === 1 ? "" : "s"} balanced without drawing down the reserve.`,
        stamp: "Authored game",
        target: '[data-affordance="season"]',
        lines: [
          `Season ${t.season}/4 · reserve ${fixed(t.storage, 0)}/100 game units`,
          `Shortfall ${fixed(t.deficit, 0)} game units · ${t.balanced} balanced seasons`,
        ],
      };
    case "street": {
      const delta = Math.abs(t.westCm - t.eastCm);
      return {
        id: delta === 0 ? "street-level" : "street-bend",
        text:
          delta === 0 && t.westCm > 0
            ? "Both blocks fell, yet the road stayed level. Pull just one now."
            : delta > 0
              ? `You made ${fixed(delta, 0)} cm of mismatch. The pipe connects two different heights; a bigger equal drop can stay level.`
              : "Two blocks share one pipe. Pull the ground, then move both ends together.",
        stamp: "Invented geometry",
        target: 'input[aria-label="West block sinking"]',
        lines: [
          `West ${t.westCm} cm · east ${t.eastCm} cm`,
          `Difference ${delta} cm · no structural safety inference`,
        ],
      };
    }
    case "radar": {
      const s = radarSample(t.xM, t.zM, t.sinkingM);
      return {
        id: `radar-${Math.floor(s.cycles)}-${t.xM === 120 ? "edge" : "target"}`,
        text:
          t.xM === 120
            ? "Your reference stays still. Walk the probe toward the centre and watch the phase clock turn."
            : `Here the ground is ${fixed(s.downM * 1000)} mm down, but the phase clock shows only ${fixed(s.wrappedCycles, 2)} of a turn. Whole turns disappear from that clock.`,
        stamp: "Synthetic radar",
        target: '[data-affordance="transect"]',
        lines: [
          `Probe (${fixed(t.xM, 0)}, ${fixed(t.zM, 0)}) m · vertical ${fixed(s.downM * 1000)} mm`,
          `LOS range +${fixed(s.deltaRangeM * 1000)} mm · total ${fixed(s.cycles, 3)} cycles`,
          `Wrapped ${fixed(s.wrappedCycles, 3)} cycles · ${fixed(s.wrappedCycles * 2 * Math.PI, 3)} rad`,
        ],
      };
    }
    case "ground":
      return {
        id: t.rate === null ? "ground-missing" : "ground-measured",
        text:
          t.rate === null
            ? "Missing is not zero. This patch gives us no usable motion estimate—so a claim that it is stable has no evidence here."
            : `At this patch: ${fixed(t.rate)} mm/yr${t.sigma === null ? ", uncertainty not supplied" : ` ± ${fixed(t.sigma)} mm/yr`}. That is a short-record relative rate, not a building verdict.`,
        stamp:
          t.rate === null ? "Missing / withheld" : "Measured · provisional",
        target: ".ed-map-image",
        lines: [
          `Tehran GUNW · ${fixed(t.lat, 5)}° N, ${fixed(t.lng, 5)}° E`,
          t.rate === null
            ? "Motion: missing / withheld, not zero"
            : `${fixed(t.rate)} mm/yr · σ ${t.sigma === null ? "not supplied" : fixed(t.sigma) + " mm/yr"}`,
        ],
      };
    case "backscatter":
      return {
        id:
          t.differenceDb === null ? "backscatter-missing" : "backscatter-cell",
        text:
          t.differenceDb === null
            ? "This cell is excluded from the shared mask. We cannot measure its change."
            : `This echo changed by ${fixed(t.differenceDb, 3)} dB. That is radar brightness—not metres of water loss or sinking ground.`,
        stamp:
          t.differenceDb === null
            ? "Missing / excluded"
            : "Measured · provisional",
        target: ".es-radar-study-stage",
        lines: [
          `Lake Mead GCOV · row ${t.row + 1}, column ${t.column + 1}`,
          t.differenceDb === null
            ? "Difference: missing / excluded"
            : `${fixed(t.differenceDb, 3)} dB · HH after − before; not depth`,
        ],
      };
    case "footprint": {
      const weak = t.tilt !== null && t.sigma !== null && t.tilt < 2 * t.sigma;
      return {
        id: weak ? "footprint-unresolved" : "footprint-limits",
        text: weak
          ? "The estimated ground tilt is smaller than twice its uncertainty. This footprint cannot settle a claim about the building’s safety."
          : "A footprint locates the ground estimate. Its tilt cannot diagnose the structure above it.",
        stamp: "Derived ground estimate",
        target: '[data-affordance="footprint"]',
        lines: [
          `OSM ${t.osmId} · ground tilt ${t.tilt === null ? "unavailable" : t.tilt.toPrecision(3) + " rad/yr"}`,
          `σ ${t.sigma === null ? "unavailable" : t.sigma.toPrecision(3) + " rad/yr"} · ${weak ? "not_enough_evidence (< 2σ)" : "not a safety assessment"}`,
        ],
      };
    }
    case "policy":
      return {
        id: `policy-${t.actionStep}`,
        text: `Your action begins at step ${t.actionStep}. The sketch ends at ${fixed(t.total)} settling units; it can bend the future line, but cannot lift back the ground already lost.`,
        stamp: "Scenario · invented units",
        target: '[data-affordance="policy"]',
        lines: [
          `Authored action step ${t.actionStep}/20 · assumed reduction ${fixed(t.reduction * 100, 0)}%`,
          `Cumulative ${fixed(t.total)} game units · not a Tehran forecast`,
        ],
      };
  }
}

export const fieldNotesSchema = z
  .object({
    generation: z.string().max(100),
    notes: z.array(echoTelemetrySchema).max(12),
  })
  .strict();
export function upsertFieldNote(
  notes: EchoTelemetry[],
  note: EchoTelemetry,
): EchoTelemetry[] {
  const safe = echoTelemetrySchema.safeParse(note);
  if (!safe.success) return notes;
  const key = (value: EchoTelemetry) =>
    value.kind === "ground"
      ? `ground-${value.rate === null ? "missing" : "measured"}`
      : value.kind === "backscatter"
        ? `backscatter-${value.differenceDb === null ? "missing" : "measured"}`
        : value.kind;
  const old = notes.find((n) => key(n) === key(note));
  if (JSON.stringify(old) === JSON.stringify(note)) return notes;
  return [...notes.filter((n) => key(n) !== key(note)), safe.data].slice(-12);
}
