import { cssVar } from './theme';
import { formatFrequency } from '../dsp/octave';

/** Logarithmic frequency axis - the only sane one for audio. */
export function freqToX(f: number, fMin: number, fMax: number, width: number): number {
  return (Math.log(Math.max(f, 1e-6) / fMin) / Math.log(fMax / fMin)) * width;
}

export function xToFreq(x: number, fMin: number, fMax: number, width: number): number {
  return fMin * Math.pow(fMax / fMin, x / width);
}

export function dbToY(db: number, dbMin: number, dbMax: number, height: number): number {
  return ((dbMax - db) / (dbMax - dbMin)) * height;
}

export function yToDb(y: number, dbMin: number, dbMax: number, height: number): number {
  return dbMax - (y / height) * (dbMax - dbMin);
}

export const GRID_FREQS = [
  20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500,
  2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000,
];

const LABELLED = new Set([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);

export interface GridOptions {
  fMin: number;
  fMax: number;
  dbMin: number;
  dbMax: number;
  dbStep?: number;
  labelFreqs?: boolean;
  labelDb?: boolean;
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  o: GridOptions,
): void {
  const grid = cssVar('--grid', '#1e242b');
  const faint = cssVar('--text-faint', '#5d6b79');
  const step = o.dbStep ?? 10;

  ctx.lineWidth = 1;
  ctx.strokeStyle = grid;
  ctx.fillStyle = faint;
  ctx.font = '10px ui-monospace, monospace';

  ctx.beginPath();
  for (const f of GRID_FREQS) {
    if (f < o.fMin || f > o.fMax) continue;
    const x = Math.round(freqToX(f, o.fMin, o.fMax, width)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  const first = Math.ceil(o.dbMin / step) * step;
  for (let db = first; db <= o.dbMax; db += step) {
    const y = Math.round(dbToY(db, o.dbMin, o.dbMax, height)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  if (o.labelFreqs !== false) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const f of GRID_FREQS) {
      if (!LABELLED.has(f) || f < o.fMin || f > o.fMax) continue;
      const x = freqToX(f, o.fMin, o.fMax, width);
      ctx.fillText(formatFrequency(f), Math.min(width - 12, Math.max(12, x)), height - 2);
    }
  }
  if (o.labelDb !== false) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let db = first; db <= o.dbMax; db += step) {
      const y = dbToY(db, o.dbMin, o.dbMax, height);
      if (y < 8 || y > height - 8) continue;
      ctx.fillText(String(db), 3, y);
    }
  }
}

/** Fill the plot background with the sunken surface colour. */
export function clearPlot(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = cssVar('--bg-sunken', '#070809');
  ctx.fillRect(0, 0, width, height);
}
