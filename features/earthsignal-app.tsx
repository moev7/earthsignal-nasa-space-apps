"use client";
import { useSearchParams } from "next/navigation";
import {
  readPublicStudyContext,
  publicStudyQuery,
} from "@/lib/public-study-context";
import { ScienceWorkspace } from "./science/science-workspace";
export function EarthsignalApp() {
  const parameters = useSearchParams();
  const context = readPublicStudyContext(
    new URLSearchParams(parameters.toString()),
  );
  const view = parameters.get("view") === "sar" ? "sar" : "decisions";
  const seeds = parameters.getAll("investigation");
  const investigation =
    seeds.length === 1 ? seeds[0] : seeds.length > 1 ? "invalid" : null;
  return (
    <ScienceWorkspace
      initialSarInvestigation={investigation}
      key={`${view}:${investigation ?? "custom"}:${context ? publicStudyQuery(context.selection) : "default"}`}
      publicStudyContext={context}
      initialView={view}
    />
  );
}
