import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GeoMap } from "@/features/catalog/geo-map";
import { REGIONS, catalogPoint } from "@/features/catalog/domain";
import { bboxSchema, type RadarBbox } from "@/lib/radar-contract";
import { pairAdvisory } from "./radar-domain";
import type { ScienceModel } from "./use-science";
export function RadarComparisonForm({ model }: { model: ScienceModel }) {
  const scenes = useMemo(
    () =>
      (model.catalog.catalog?.scenes ?? [])
        .filter((s) => s.product === "GCOV" && s.platform === "NISAR")
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [model.catalog.catalog],
  );
  const point = (model.catalog.query.point ? catalogPoint(model.catalog.query.point) : null) ?? REGIONS[model.catalog.query.region].point ?? REGIONS.mead.point;
  const initial: RadarBbox = model.comparisonDraft?.bbox ?? [
    Math.max(-180, point[0] - 0.005),
    Math.max(-85, point[1] - 0.005),
    Math.min(180, point[0] + 0.005),
    Math.min(85, point[1] + 0.005),
  ];
  const [beforeId, setBeforeId] = useState(
    model.comparisonDraft?.beforeId ?? "",
  );
  const [afterId, setAfterId] = useState(model.comparisonDraft?.afterId ?? "");
  const [coordinates, setCoordinates] = useState(initial.map(String));
  const [mapBbox, setMapBbox] = useState<RadarBbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bounds] = useState(
    () =>
      [
        [initial[1], initial[0]],
        [initial[3], initial[2]],
      ] as [[number, number], [number, number]],
  );
  const bbox = coordinates.map((v) => (v.trim() === "" ? NaN : Number(v)));
  const parsed = bboxSchema.safeParse(bbox);
  const advisory = pairAdvisory(
    scenes.find((s) => s.id === beforeId),
    scenes.find((s) => s.id === afterId),
  );
  const pairScenes = scenes.filter(
    (scene) => scene.id === beforeId || scene.id === afterId,
  );
  const available =
    model.radarJobs.status === "ready" && model.radarJobs.capability?.ready;
  const valid =
    available &&
    beforeId &&
    afterId &&
    parsed.success &&
    !advisory.errors.length;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || !parsed.success) return;
    setError(null);
    try {
      await model.radarJobs.submitJob({ beforeId, afterId, bbox: parsed.data });
      model.setComparisonDraft(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Submission failed. Please retry.",
      );
    }
  };
  return (
    <form className="radar-form evidence" onSubmit={submit}>
      <div className="section-heading">
        <h2>Compare radar backscatter</h2>
        <Button
          type="button"
          variant="ghost"
          onClick={() => model.setComparisonDraft(null)}
        >
          Close
        </Button>
      </div>
      <p>
        Frequency A · HH (HHHH) · linear gamma-zero power. Choose acquisitions
        and a small map crop.
      </p>
      {!available && (
        <p className="notice" role="status">
          {model.radarJobs.error ??
            model.radarJobs.capability?.message ??
            "Checking processing access…"}
        </p>
      )}
      {(
        [
          ["Before acquisition", beforeId, setBeforeId],
          ["After acquisition", afterId, setAfterId],
        ] as const
      ).map(([label, value, update]) => (
        <label className="field-label" key={label}>
          {label}
          <select
            aria-label={label}
            value={value}
            onChange={(e) => update(e.target.value)}
          >
            <option value="">Choose a NISAR GCOV acquisition</option>
            {value && !scenes.some(scene => scene.id === value) && <option value={value}>Selected acquisition · {value}</option>}
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.startTime.slice(0, 10)} · track {s.path ?? "unknown"} · frame{" "}
                {s.frame ?? "unknown"} · {s.id}
              </option>
            ))}
          </select>
        </label>
      ))}
      {!scenes.length && (
        <p>
          No NISAR GCOV acquisitions loaded for this study area and date range.
        </p>
      )}
      <div className="radar-crop-map">
        <GeoMap
          scenes={pairScenes}
          selectedId={beforeId || undefined}
          focusBounds={bounds}
          viewKey={`crop-${model.catalog.query.point ?? model.catalog.query.region}`}
          maxFitZoom={16}
          onViewportChange={setMapBbox}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!mapBbox}
        onClick={() => mapBbox && setCoordinates(mapBbox.map(String))}
      >
        Use current map extent
      </Button>
      <div className="radar-coordinates">
        {["West", "South", "East", "North"].map((label, i) => (
          <label key={label}>
            {label}
            <Input
              type="number"
              step="any"
              value={coordinates[i]}
              onChange={(e) =>
                setCoordinates((previous) =>
                  previous.map((v, k) => (k === i ? e.target.value : v)),
                )
              }
            />
          </label>
        ))}
      </div>
      {!parsed.success && (
        <p role="alert">
          Enter four finite, ordered coordinates within longitude/latitude
          bounds.
        </p>
      )}
      <p className="filter-hint">
        Maximum{" "}
        {new Intl.NumberFormat().format(
          model.radarJobs.capability?.maxPixels ?? 1_000_000,
        )}{" "}
        native crop pixels. Zoom in before taking the map extent. Analytical
        inputs are cropped without resampling.
      </p>
      <div className="radar-compatibility" aria-label="Pair compatibility">
        {advisory.errors.map((s) => (
          <p key={s} role="alert">
            {s}
          </p>
        ))}
        {advisory.unknown.map((s) => (
          <p key={s}>{s}</p>
        ))}
        {beforeId && afterId && !advisory.errors.length && (
          <p>
            Catalog checks passed provisionally. Science-file compatibility is
            still pending.
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Button
        type="submit"
        disabled={
          !valid ||
          model.radarJobs.submitting ||
          model.catalog.status === "loading"
        }
      >
        {model.radarJobs.submitting ? "Submitting…" : "Submit processing job"}
      </Button>
    </form>
  );
}
