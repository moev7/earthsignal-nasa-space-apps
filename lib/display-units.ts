export function displayMeasurement(value: number | null, unit: string, metric: boolean, difference = false) {
  if (!metric || value === null) return { value, unit };
  if (unit === 'K') return { value: difference ? value : value - 273.15, unit: '°C' };
  if (unit === 'ft') return { value: value * .3048, unit: 'm' };
  if (unit === 'ft^3/s') return { value: value * .028316846592, unit: 'm³/s' };
  if (unit === 'ft^3/s/year') return { value: value * .028316846592, unit: 'm³/s/year' };
  return { value, unit };
}
