"use client";
import { useSearchParams } from "next/navigation";
import { readPublicStudyContext, publicStudyQuery } from "@/lib/public-study-context";
import { ScienceWorkspace } from "./science/science-workspace";
export function EarthsignalApp() {
  const parameters = useSearchParams();
  const context = readPublicStudyContext(new URLSearchParams(parameters.toString()));
  return <ScienceWorkspace key={context ? publicStudyQuery(context.selection) : "default"} publicStudyContext={context} />;
}
