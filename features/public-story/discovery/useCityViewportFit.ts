// Kept as a compatibility export for the original city fit contract.
export { sceneCanvasBudget as cityCanvasBudget } from "./useSceneViewportFit";
import { useSceneViewportFit } from "./useSceneViewportFit";
export function useCityViewportFit() {
  return useSceneViewportFit(".es-city-stage", "--city-canvas-height");
}
