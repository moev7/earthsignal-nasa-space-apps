import type { PulsePhase, SpacecraftPart } from './types';

export const HARDWARE_SOURCE = 'https://www.jpl.nasa.gov/press-kits/nisar/quick-facts/';
export const PARTS: readonly { id: SpacecraftPart; label: string; explanation: string; fact: string }[] = [
  { id: 'reflector', label: 'Reflector', explanation: 'The large mesh reflector is part of the radar antenna, directing radio signals toward Earth and collecting their echoes.', fact: 'About 12 m in diameter.' },
  { id: 'arrays', label: 'Solar arrays', explanation: 'Two deployable wings turn sunlight into electrical power for the spacecraft and its instruments.', fact: 'Each array is just over 5.5 m long; together they provide about 5 kW.' },
  { id: 'boom', label: 'Boom', explanation: 'The deployed boom holds the reflector away from the spacecraft body. Follow its structure from the gold body to the antenna.', fact: 'The reflector boom is about 9 m long.' },
  { id: 'instruments', label: 'Radar instruments', explanation: 'NISAR carries L-band and S-band synthetic aperture radars. Active radio instruments send their own signals; they are not optical cameras.', fact: 'L-band and S-band SAR; the bus and radar payload together are about 5.5 m long.' },
];
export const PULSE_DURATION_MS = 2400;
export const MANUAL_PULSE = { send: 0.2, echo: 0.5, receive: 1 } as const;
export const PULSE_TEXT: Record<PulsePhase, string> = {
  idle: 'Ready · send a radio pulse toward the ground.',
  send: 'Send · the radar directs a radio signal toward Earth.',
  echo: 'Ground echo · some of the signal scatters back toward the spacecraft.',
  receive: 'Receive · the radar records the returning echo. One echo alone does not measure displacement.',
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Shared by animated geometry, manual still states and the accessible readout.
 * Purely illustrative reflection; no orbital distances, phase or timing physics. */
export function pulseAt(progress: number | null) {
  if (progress === null) return { phase: 'idle' as PulsePhase, outbound: 0, echo: 0, returning: 0, marker: 0 };
  const p = clamp(Number.isFinite(progress) ? progress : 0);
  return {
    phase: (p < 0.4 ? 'send' : p < 0.65 ? 'echo' : 'receive') as PulsePhase,
    outbound: clamp(p / 0.4),
    echo: clamp((p - 0.4) / 0.25),
    returning: clamp((p - 0.65) / 0.35),
    marker: p < 0.4 ? clamp(p / 0.4) : p < 0.65 ? 1 : 1 - clamp((p - 0.65) / 0.35),
  };
}
// Major dimensions follow JPL quick facts; local placement and all small details
// are schematic. One scene unit represents roughly one metre on the spacecraft.
export const DIMENSIONS = { reflectorDiameter: 12, boomLength: 9, busPayloadLength: 5.5, arrayLength: 5.6 } as const;
export const SIGNAL_START = [-7.2, 0.1, 0] as const;
// Visual composition only: a recognizable planet below the enlarged spacecraft.
// Keep several reflector diameters of clear space; the separate orbit diagram
// supplies actual orbital scale. The echo target sits ON this schematic sphere.
export const EARTH_CONTEXT = { radius: 48, center: [-12, -85, -35] as const } as const;
export const SIGNAL_GROUND = [-3.5, -85 + Math.sqrt(48 ** 2 - 8.5 ** 2 - 3 ** 2), -32] as const;
