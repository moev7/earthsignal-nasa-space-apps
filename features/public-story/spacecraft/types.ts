export type SpacecraftPart = 'reflector' | 'arrays' | 'boom' | 'instruments';
export type PulsePhase = 'idle' | 'send' | 'echo' | 'receive';
export type CameraAction = 'overview' | SpacecraftPart | 'left' | 'right' | 'in' | 'out';
export interface SpacecraftState {
  selectedPart: SpacecraftPart;
  interactive: boolean;
  pulse: number | null;
}
export interface SpacecraftScene {
  update(state: SpacecraftState): void;
  pulse(progress: number | null): void;
  resize(width: number, height: number): void;
  view(action: CameraAction): void;
  dispose(): void;
}
export type SpacecraftSceneLoader = () => Promise<{ createSpacecraftScene(canvas: HTMLCanvasElement): SpacecraftScene }>;
