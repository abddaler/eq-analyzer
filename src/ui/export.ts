import type { Band } from '../dsp/octave';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Save what is on a canvas right now. */
export function exportCanvasPng(canvas: HTMLCanvasElement, name = 'eq-scope'): void {
  canvas.toBlob((blob) => {
    if (blob) download(blob, `${name}-${timestamp()}.png`);
  }, 'image/png');
}

export interface CsvColumn {
  header: string;
  values: ArrayLike<number> | null;
}

/**
 * Band table as CSV. Levels are written with two decimals - more would be
 * false precision for an acoustic measurement.
 */
export function exportBandsCsv(bands: Band[], columns: CsvColumn[], name = 'eq-scope'): void {
  const present = columns.filter((c) => c.values !== null);
  const head = ['band_hz', 'center_hz', 'lo_hz', 'hi_hz', ...present.map((c) => c.header)];
  const lines = [head.join(',')];
  for (let b = 0; b < bands.length; b++) {
    const row = [
      String(bands[b].nominal),
      bands[b].center.toFixed(2),
      bands[b].lo.toFixed(2),
      bands[b].hi.toFixed(2),
      ...present.map((c) => {
        const v = c.values![b];
        return Number.isFinite(v) ? v.toFixed(2) : '';
      }),
    ];
    lines.push(row.join(','));
  }
  download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${name}-${timestamp()}.csv`);
}
