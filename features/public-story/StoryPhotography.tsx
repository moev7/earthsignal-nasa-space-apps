"use client";

import { lazy, Suspense } from "react";
import { SceneHelp } from "./StoryStage";
import media from "@/docs/internal/story-media-sources.json";

type Photograph = "nisar" | "tehran" | "tokyo";
const NisarExplorer = lazy(() => import("./spacecraft/NisarExplorer"));

/** Context photographs and a spacecraft concept, kept distinct from data. */
export function StoryPhotography({ subject, className = "" }: { subject: Photograph; className?: string }) {
  const asset = media[subject];
  const photo = <figure className={`es-story-photo es-photo-${subject} ${className}`}>
    <div className="es-photo-object">
      {/* Local, pre-sized editorial assets; no image service or runtime transform. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.src} width={asset.width} height={asset.height} alt={asset.alt} loading="lazy" decoding="async" />
      {subject === "nisar" && <>
        <svg className="es-satellite-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M22 20 H34 L48 32 M78 72 H66 L57 56"/><circle cx="48" cy="32" r=".8"/><circle cx="57" cy="56" r=".8"/></svg>
        <div className="es-photo-part es-photo-reflector"><SceneHelp label="Radar reflector"><p>The large reflector forms part of NISAR’s radar antenna. This rendering shows the instrument; it is not a satellite observation.</p></SceneHelp></div>
        <div className="es-photo-part es-photo-arrays"><SceneHelp label="Solar arrays"><p>Solar arrays power the spacecraft. The radar sends signals to Earth and records their return.</p></SceneHelp></div>
      </>}
    </div>
    <figcaption>
      <span>{subject === "nisar" ? "NISAR · artist’s concept" : `${subject === "tehran" ? "Tehran" : "Tokyo"} · city photograph, for context`}</span>
      <SceneHelp label={`Image credit and context: ${subject === "nisar" ? "NISAR" : subject === "tehran" ? "Tehran" : "Tokyo"}`}>
        <p>{asset.caption} This image does not show a subsidence measurement or establish building damage.</p>
        <p>{asset.credit}. <a href={asset.sourceUrl}>Original source</a> · <a href={asset.licenseUrl}>{asset.license}</a>. {asset.changes}</p>
      </SceneHelp>
    </figcaption>
  </figure>;
  return subject === "nisar"
    ? <Suspense fallback={photo}><NisarExplorer fallback={photo} className={className}/></Suspense>
    : photo;
}
