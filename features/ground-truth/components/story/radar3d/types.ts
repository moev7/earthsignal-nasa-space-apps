import type { RadarColourMode, RadarSiteId } from "@/lib/radar-interferometry";
export type Observation = "before" | "after" | "compare";
export type CameraPreset = "reset" | "top" | "profile";
export type CameraAction = CameraPreset | "left" | "right" | "in" | "out";
export interface RadarSceneState {
  sinkingM: number;
  observation: Observation;
  interactive: boolean;
  selectedSite?: RadarSiteId;
  colourMode?: RadarColourMode;
  probeXM?: number;
}
export interface RadarScene {
  update(state: RadarSceneState): void;
  signal?(progress: number | null): void;
  resize(width: number, height: number): void;
  view(action: CameraAction): void;
  dispose(): void;
}
export type RadarSceneLoader = () => Promise<{
  createRadarScene(canvas: HTMLCanvasElement): RadarScene;
}>;
