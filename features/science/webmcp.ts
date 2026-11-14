"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { z } from "zod";
import { artifactUrl } from "@/lib/radar-contract";
import type { ScienceModel } from "./use-science";
import { recordTitle, water } from "./domain";
type Registry = {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute(input: unknown): unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};
export function useScienceTools(model: ScienceModel) {
  const current = useRef(model);
  useLayoutEffect(() => { current.current = model; }, [model]);
  useEffect(() => {
    const registry = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!registry) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<Registry["registerTool"]>[0]) => {
      try {
        void Promise.resolve(
          registry.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "list_real_earth_observations",
      description:
        "Read the currently filtered real collection: historical optical water studies, radar catalog acquisitions and verified backscatter comparisons. Backscatter differences are not derived hazards.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        z.object({}).strict().parse(input);
        return current.current.visible.map((record) => ({
          id: record.id,
          title: recordTitle(record, current.current.catalog.query.region, current.current.catalog.query.point),
          kind: record.kind,
          source:
            record.kind === "water"
              ? water.source
              : record.kind === "radar-change" ? artifactUrl(record.job.id, "manifest.json") : current.current.catalog.catalog?.queryUrl,
          date: record.kind === "water" ? water.date : record.kind === "radar-change" ? record.job.result?.after.acquiredAt : record.scene.startTime,
        }));
      },
    });
    register({
      name: "select_real_earth_observation",
      description:
        "Select an existing visible real observation and update the same card, map and detail panel as the user interface.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      async execute(input) {
        const { id } = z.object({ id: z.string() }).strict().parse(input);
        if (!current.current.visible.some((r) => r.id === id))
          throw new Error("Observation not visible in current filters");
        current.current.select(id);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return {
          selectedId: current.current.selected?.id,
          kind: current.current.selected?.kind,
        };
      },
    });
    return () => lifecycle.abort();
  }, []);
}
