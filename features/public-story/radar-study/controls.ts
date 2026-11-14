import type { RadarCell, RadarRegion } from '@/lib/public-radar-study';

export type RadarSelection = RadarCell | RadarRegion;
export type RadarMode = 'compare' | 'before' | 'after' | 'difference';

/** Only native cells are selected; display enlargement never creates samples. */
export function validSelection(selection: RadarSelection | null | undefined, width: number, height: number): RadarSelection | null {
  if (!selection) return null;
  if ('row' in selection) {
    return Number.isInteger(selection.row) && Number.isInteger(selection.column) && selection.row >= 0 && selection.column >= 0 && selection.row < height && selection.column < width ? selection : null;
  }
  const { left, top, right, bottom } = selection;
  return [left, top, right, bottom].every(Number.isInteger) && left >= 0 && top >= 0 && left <= right && top <= bottom && right < width && bottom < height ? selection : null;
}

export function moveRadarCell(cell: RadarCell, key: string, width: number, height: number): RadarCell | null {
  switch (key) {
    case 'ArrowLeft': return { row: cell.row, column: Math.max(0, cell.column - 1) };
    case 'ArrowRight': return { row: cell.row, column: Math.min(width - 1, cell.column + 1) };
    case 'ArrowUp': return { row: Math.max(0, cell.row - 1), column: cell.column };
    case 'ArrowDown': return { row: Math.min(height - 1, cell.row + 1), column: cell.column };
    default: return null;
  }
}

export function selectionRegion(selection: RadarSelection): RadarRegion {
  return 'row' in selection ? { left: selection.column, right: selection.column, top: selection.row, bottom: selection.row } : selection;
}

export function formatRadarDb(value: number | null, signed = false): string {
  return value === null ? 'Excluded — no measurement' : `${signed && value > 0 ? '+' : ''}${value.toFixed(2)} dB`;
}
