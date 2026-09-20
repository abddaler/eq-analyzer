import { useCallback } from 'react';
import type { AnalyzerEngine } from '../../dsp/engine';
import { Canvas } from './Canvas';
import { clearPlot, dbToY, drawGrid, freqToX, xToFreq } from '../plot';
import { cssVar } from '../theme';

const F_MIN = 20;
const F_MAX = 20000;
/** Coherence below this is not worth reading, so the trace is drawn dim. */
export const COHERENCE_FLOOR = 0.5;

interface Props {
  engine: AnalyzerEngine;
  /** Display smoothing, in fractions of an octave. */
  smoothingFraction: number;
  height?: number | string;
}

interface Column {
  db: number;
  deg: number;
  coherence: number;
  valid: boolean;
}

/**
 * Average the bins that fall inside one pixel's smoothing window.
 * Phase is averaged as a vector, otherwise values either side of +-180 would
 * cancel into nonsense.
 */
function columnAt(
  magnitudeDb: Float64Array,
  phaseDeg: Float64Array,
  coherence: Float64Array,
  binWidth: number,
  frequency: number,
  octaves: number,
): Column {
  const half = Math.pow(2, octaves / 2);
  const from = Math.max(1, Math.round(frequency / half / binWidth));
  const to = Math.min(magnitudeDb.length - 1, Math.round((frequency * half) / binWidth));
  if (to < from) return { db: 0, deg: 0, coherence: 0, valid: false };
  let db = 0;
  let sin = 0;
  let cos = 0;
  let coh = 0;
  let count = 0;
  for (let k = from; k <= to; k++) {
    db += magnitudeDb[k];
    const rad = (phaseDeg[k] * Math.PI) / 180;
    sin += Math.sin(rad);
    cos += Math.cos(rad);
    coh += coherence[k];
    count++;
  }
  return {
    db: db / count,
    deg: (Math.atan2(sin / count, cos / count) * 180) / Math.PI,
    coherence: coh / count,
    valid: true,
  };
}

export function TransferPlot({ engine, smoothingFraction, height = '30vh' }: Props) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      clearPlot(ctx, w, h);
      const result = engine.snapshot.transfer;

      const magHeight = Math.round(h * 0.55);
      const phaseHeight = Math.round(h * 0.25);
      const cohHeight = h - magHeight - phaseHeight;

      const magMin = -30;
      const magMax = 18;
      drawGrid(ctx, w, magHeight, {
        fMin: F_MIN,
        fMax: F_MAX,
        dbMin: magMin,
        dbMax: magMax,
        dbStep: 12,
        labelFreqs: false,
      });

      ctx.save();
      ctx.translate(0, magHeight);
      drawGrid(ctx, w, phaseHeight, {
        fMin: F_MIN,
        fMax: F_MAX,
        dbMin: -180,
        dbMax: 180,
        dbStep: 180,
        labelFreqs: false,
        labelDb: false,
      });
      ctx.restore();

      ctx.save();
      ctx.translate(0, magHeight + phaseHeight);
      drawGrid(ctx, w, cohHeight, {
        fMin: F_MIN,
        fMax: F_MAX,
        dbMin: 0,
        dbMax: 1,
        dbStep: 1,
        labelDb: false,
      });
      ctx.restore();

      if (!result || result.frames === 0) return;

      const octaves = 1 / smoothingFraction;
      const columns: Column[] = new Array(Math.ceil(w));
      for (let x = 0; x < columns.length; x++) {
        const f = xToFreq(x + 0.5, F_MIN, F_MAX, w);
        columns[x] = columnAt(
          result.magnitudeDb,
          result.phaseDeg,
          result.coherence,
          result.binWidth,
          f,
          octaves,
        );
      }

      const trace = cssVar('--trace', '#8be04e');
      const accent = cssVar('--accent', '#4ea8ff');
      const dim = cssVar('--untrusted', '#4a5663');

      // Magnitude, drawn in segments so low-coherence stretches stay dim.
      let previous: { x: number; y: number; trusted: boolean } | null = null;
      for (let x = 0; x < columns.length; x++) {
        const c = columns[x];
        if (!c.valid) continue;
        const y = dbToY(c.db, magMin, magMax, magHeight);
        const trusted = c.coherence >= COHERENCE_FLOOR;
        if (previous) {
          ctx.strokeStyle = trusted && previous.trusted ? trace : dim;
          ctx.lineWidth = trusted && previous.trusted ? 1.75 : 1;
          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        previous = { x, y, trusted };
      }

      // Phase: points rather than a line, so wraps do not draw vertical bars.
      for (let x = 0; x < columns.length; x++) {
        const c = columns[x];
        if (!c.valid) continue;
        const y = magHeight + dbToY(c.deg, -180, 180, phaseHeight);
        ctx.fillStyle = c.coherence >= COHERENCE_FLOOR ? accent : dim;
        ctx.fillRect(x, y - 0.75, 1.5, 1.5);
      }

      // Coherence.
      ctx.strokeStyle = cssVar('--target', '#c9a227');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < columns.length; x++) {
        const c = columns[x];
        if (!c.valid) continue;
        const y = magHeight + phaseHeight + dbToY(c.coherence, 0, 1, cohHeight);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Separators between the three panes.
      ctx.strokeStyle = cssVar('--line-strong', '#3a444f');
      ctx.lineWidth = 1;
      for (const y of [magHeight, magHeight + phaseHeight]) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      ctx.fillStyle = cssVar('--text-faint', '#5d6b79');
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('dB', 3, 11);
      ctx.fillText('°', 3, magHeight + 11);
      ctx.fillText('γ²', 3, magHeight + phaseHeight + 11);
      ctx.textAlign = 'center';
      for (const f of [50, 100, 500, 1000, 5000, 10000]) {
        ctx.fillText(
          f >= 1000 ? `${f / 1000}k` : String(f),
          freqToX(f, F_MIN, F_MAX, w),
          h - 2,
        );
      }
    },
    [engine, smoothingFraction],
  );

  return <Canvas draw={draw} animate height={height} ariaLabel="transfer function" />;
}
