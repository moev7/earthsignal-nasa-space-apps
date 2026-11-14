import type { MissionId } from '@/lib/story-missions';
/** Station context; the live experiments own their prompts and consequences. */
export const STATIONS: Record<MissionId, { place: string }> = {
  aquifer: { place: 'Below the city' },
  uneven: { place: 'Street laboratory' },
  radar: { place: 'Orbital observatory' },
  evidence: { place: 'The real record · Tehran' },
  tokyo: { place: 'A different ending · Tokyo' },
};
