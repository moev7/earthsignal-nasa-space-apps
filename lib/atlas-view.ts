import type { DataState } from '@/features/ground-truth/data/types';
export type AtlasLayer = 'subsidence' | 'buildings' | 'observations' | 'groundwater' | 'agriculture';
export type AtlasBasemap = 'streets' | 'satellite' | 'none';
/** Availability belongs to the chosen layer, never to a neighbouring dataset. */
export function atlasEvidence(layer: AtlasLayer, record: DataState, bundle: 'ready' | 'loading' | 'error' | null) {
  if (record === 'measured') {
    if (layer !== 'subsidence' && layer !== 'buildings') return 'illustrated';
    if (bundle !== 'ready') return bundle ?? 'loading';
    return 'measured';
  }
  if (layer === 'buildings') return 'unavailable';
  return record === 'demo' ? 'illustrated' : record;
}
