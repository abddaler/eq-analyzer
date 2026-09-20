/**
 * Frequency zones used to talk about a mix in words rather than numbers.
 * The ranges are the ones on the spec's table; the wording lives in i18n.
 */
export type ZoneId = 'sub' | 'bass' | 'lowMid' | 'mid' | 'upperMid' | 'presence' | 'air';

export interface Zone {
  id: ZoneId;
  from: number;
  to: number;
}

export const ZONES: Zone[] = [
  { id: 'sub', from: 20, to: 60 },
  { id: 'bass', from: 60, to: 250 },
  { id: 'lowMid', from: 250, to: 500 },
  { id: 'mid', from: 500, to: 2000 },
  { id: 'upperMid', from: 2000, to: 4000 },
  { id: 'presence', from: 4000, to: 6000 },
  { id: 'air', from: 6000, to: 20000 },
];

export function zoneFor(frequency: number): Zone {
  for (const zone of ZONES) {
    if (frequency >= zone.from && frequency < zone.to) return zone;
  }
  return frequency < ZONES[0].from ? ZONES[0] : ZONES[ZONES.length - 1];
}
