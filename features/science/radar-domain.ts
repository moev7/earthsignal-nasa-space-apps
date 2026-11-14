import type { Scene } from "@/features/catalog/domain";
export function pairAdvisory(before?: Scene, after?: Scene) {
  const errors: string[] = [],
    unknown: string[] = [];
  if (!before || !after)
    return {
      errors,
      unknown: ["Choose both acquisitions to inspect catalog compatibility."],
    };
  if (before.id === after.id) errors.push("Choose different acquisitions.");
  if (before.startTime >= after.startTime)
    errors.push("The before acquisition must precede the after acquisition.");
  for (const [label, a, b] of [
    ["track", before.path, after.path],
    ["frame", before.frame, after.frame],
    ["orbit direction", before.direction, after.direction],
    ["processing release", before.processorVersion, after.processorVersion],
    ["collection", before.collection, after.collection],
  ] as const) {
    if (
      a === null ||
      b === null ||
      a === "unknown" ||
      b === "unknown" ||
      !String(a) ||
      !String(b)
    )
      unknown.push(`${label} is unknown in the catalog.`);
    else if (a !== b) errors.push(`The ${label} differs.`);
  }
  if (
    before.polarization.length &&
    after.polarization.length &&
    [...before.polarization].sort().join() !==
      [...after.polarization].sort().join()
  )
    errors.push("Catalog polarization modes differ.");
  unknown.push(
    "Science-file acquisition mode, gamma-zero calibration, masks and native grid are verified during processing.",
  );
  return { errors, unknown };
}
