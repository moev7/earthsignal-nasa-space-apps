"use client";
import { useState } from "react";
import {
  NISAR_BUNDLES,
  useNisarBundle,
  useNisarBuildings,
  type BuildingCollection,
} from "@/features/ground-truth/data/nisar";
import { directEcho } from "@/lib/echo-director";
import { useFieldTelemetry } from "../quest/GameDirector";
import { FieldPartner } from "./FieldPartner";

export function FootprintAudit({ onProof }: { onProof: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const state = useNisarBundle(enabled ? NISAR_BUNDLES.tehran : null);
  const bundle = state?.status === "ready" ? state.data : null;
  const buildings = useNisarBuildings(NISAR_BUNDLES.tehran, bundle, enabled);
  if (!enabled)
    return (
      <section className="ex-footprints">
        <h3>A footprint is a location, not a verdict.</h3>
        <p>
          Open the verified 22,955-footprint collection to inspect real ground
          estimates. This optional file is about 12 MB; its observations carry
          their own uncertainty.
        </p>
        <button type="button" onClick={() => setEnabled(true)}>
          Load checked footprint evidence
        </button>
      </section>
    );
  if (state?.status === "error" || buildings?.status === "error")
    return (
      <p role="alert">
        The footprint evidence could not be verified. No substitute examples
        were invented. <a href="/explore">Open the measured explorer</a>
      </p>
    );
  if (buildings?.status !== "ready")
    return (
      <p role="status">Checking the footprint collection before showing it…</p>
    );
  return <FootprintSamples collection={buildings.data} onProof={onProof} />;
}
function FootprintSamples({
  collection,
  onProof,
}: {
  collection: BuildingCollection;
  onProof: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const weak = collection.features
    .filter((f) => f.properties.category === "not_enough_evidence")
    .slice(0, 3);
  const other = collection.features
    .filter((f) => f.properties.category === "high")
    .slice(0, 3);
  const choices = [...other, ...weak];
  const feature = choices.find((f) => f.properties.osm_id === selected),
    b = feature?.properties;
  const telemetry = b
    ? {
        kind: "footprint" as const,
        osmId: b.osm_id,
        tilt: b.ground_tilt_per_year ?? null,
        sigma: b.ground_tilt_sigma_per_year ?? null,
      }
    : null;
  useFieldTelemetry(telemetry);
  return (
    <section
      className="ex-footprints"
      aria-label="Inspect actual verified footprints"
    >
      <h3>Look through the outline to the evidence below.</h3>
      <p>
        Six actual outlines from the verified collection, arranged for
        inspection. They are not shown in geographic positions. Tap one and
        inspect the uncertainty.
      </p>
      <div className="ex-footprint-tray">
        {choices.map((f) => {
          const ring = f.geometry.coordinates[0],
            xs = ring.map((v) => v[0]),
            ys = ring.map((v) => v[1]),
            west = Math.min(...xs),
            south = Math.min(...ys),
            span =
              Math.max(Math.max(...xs) - west, Math.max(...ys) - south) || 1;
          return (
            <button
              type="button"
              data-affordance="footprint"
              key={f.properties.osm_id}
              aria-pressed={selected === f.properties.osm_id}
              onClick={() => {
                setSelected(f.properties.osm_id);
                const p = f.properties;
                if (
                  p.category === "not_enough_evidence" &&
                  p.ground_tilt_per_year !== undefined &&
                  p.ground_tilt_sigma_per_year !== undefined &&
                  p.ground_tilt_per_year < 2 * p.ground_tilt_sigma_per_year
                )
                  onProof();
              }}
            >
              <svg viewBox="0 0 120 100" aria-hidden="true">
                <polygon
                  points={ring
                    .map(
                      (v) =>
                        `${15 + ((v[0] - west) / span) * 80},${85 - ((v[1] - south) / span) * 70}`,
                    )
                    .join(" ")}
                  fill="var(--earth-accent)"
                  fillOpacity=".12"
                  stroke="var(--earth-accent)"
                  strokeWidth="1.5"
                />
              </svg>
              <span>OSM {f.properties.osm_id}</span>
            </button>
          );
        })}
      </div>
      {telemetry && (
        <FieldPartner
          found={false}
          hint="Try several outlines. Compare the tilt with twice its uncertainty; an unresolved ground estimate cannot decide building safety."
          reading={directEcho(telemetry)}
        >
          <></>
        </FieldPartner>
      )}
      {b && (
        <dl className="ex-phase-numbers">
          <div>
            <dt>Ground tilt</dt>
            <dd>
              {b.ground_tilt_per_year?.toPrecision(3) ?? "Unavailable"} rad/yr
            </dd>
          </div>
          <div>
            <dt>Uncertainty σ</dt>
            <dd>
              {b.ground_tilt_sigma_per_year?.toPrecision(3) ?? "Unavailable"}{" "}
              rad/yr
            </dd>
          </div>
          <div>
            <dt>Ground evidence class</dt>
            <dd>{b.category.replaceAll("_", " ")}</dd>
          </div>
        </dl>
      )}
      <p className="ed-evidence">
        Ground estimates · 560 m local support · provisional short-record rates.
        Neither a resolved tilt nor an unresolved one diagnoses structural
        safety. Outlines ©OpenStreetMap contributors, ODbL 1.0.
      </p>
    </section>
  );
}
