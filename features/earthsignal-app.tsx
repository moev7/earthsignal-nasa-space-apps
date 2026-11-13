"use client";
import { useSearchParams } from "next/navigation";
import { readPublicStudyContext, publicStudyQuery } from "@/lib/public-study-context";
import { ScienceWorkspace } from "./science/science-workspace";
export function EarthsignalApp() {
  const parameters = useSearchParams();
  const context = readPublicStudyContext(new URLSearchParams(parameters.toString()));
  const view = parameters.get("view") === "sar" ? "sar" : "decisions";
  return <ScienceWorkspace key={`${view}:${context ? publicStudyQuery(context.selection) : "default"}`} publicStudyContext={context} initialView={view} />;
}
