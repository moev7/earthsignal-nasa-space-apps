/** Qualitative teaching controls only. Values drive drawings, never physical rates. */
export type CauseId = 'groundwater' | 'irrigation' | 'drought' | 'geology' | 'urban';
export type Experiment = { amount: number; peak: number; alternative: boolean; second: number };
export type Experiments = Record<CauseId, Experiment>;
export const CAUSE_IDS: CauseId[] = ['groundwater', 'irrigation', 'drought', 'geology', 'urban'];
export const initialExperiments = (): Experiments => Object.fromEntries(CAUSE_IDS.map(id => [id, { amount: 0, peak: 0, alternative: false, second: 0 }])) as Experiments;
export type ExperimentAction = { id: CauseId } & ({ type: 'amount' | 'second'; value: number } | { type: 'alternative'; value: boolean } | { type: 'snapshot'; value: Experiment } | { type: 'reset' });
const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export function experimentReducer(state: Experiments, action: ExperimentAction): Experiments {
  const previous = state[action.id];
  const next = action.type === 'reset' ? initialExperiments()[action.id]
    : action.type === 'snapshot' ? { amount: clamp(action.value.amount), peak: Math.max(clamp(action.value.amount), clamp(action.value.peak)), second: clamp(action.value.second), alternative: action.value.alternative }
    : action.type === 'amount' ? { ...previous, amount: clamp(action.value), peak: Math.max(previous.peak, clamp(action.value)) }
    : action.type === 'second' ? { ...previous, second: clamp(action.value) }
    : { ...previous, alternative: action.value };
  return { ...state, [action.id]: next };
}
export function experimentReading(id: CauseId, state: Experiment): string {
  const { amount, peak, alternative, second } = state;
  if (id === 'groundwater') return amount > .05 ? 'Water pressure falls. Fine layers squeeze and the surface settles.' : peak > .05 ? 'Water has returned. Some compacted pore space can remain lost.' : 'Water occupies the pores between grains. Start pumping to see the change.';
  if (id === 'irrigation') return !amount ? 'No extra irrigation demand is added in this experiment.' : alternative ? 'Surface water supplies this irrigation demand. Less groundwater is needed here.' : 'More irrigated land draws more water from the well in this example.';
  if (id === 'drought') return amount > .05 ? 'Less rain means less replenishment. With pumping held steady, the groundwater shortfall grows.' : 'Rain replenishes some groundwater. Pumping is held steady in this comparison.';
  if (id === 'geology') return !amount && peak > .05 ? 'Water returns: the coarse material rebounds here, while the fine layer stays more compacted.' : amount > .05 ? 'The same pressure loss squeezes the fine layer more than the coarse material.' : 'Compare coarse grains with a fine layer, then lower the water pressure.';
  return amount > .05 && second > .05 ? 'The load compresses soft ground locally. Paving sends more rain toward runoff: two different effects.' : amount > .05 ? 'Added weight can compress soft ground locally. This is separate from groundwater withdrawal.' : second > .05 ? 'Paving diverts more rain toward runoff. Less can enter the ground locally.' : 'Add a load or pave the surface. Watch the two pathways separately.';
}
