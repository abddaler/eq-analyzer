import { useCallback, useRef, useState } from 'react';
import type { AnalyzerEngine, EngineSnapshot } from '../../dsp/engine';
import { powerToDb } from '../../dsp/spectrum';
import { frequencyToNote, nearestGeqBand } from '../../dsp/notes';
import { GEQ_31_BANDS, formatFrequency } from '../../dsp/octave';
import { MIN_SNR_DB } from '../../analysis/confidence';
import { Canvas, type PointerInfo } from './Canvas';
import { clearPlot, drawDbLabels, drawGrid, dbToY, freqToX, xToFreq } from '../plot';
import { cssVar } from '../theme';

export type PlotMode = 'rta' | 'fft';

export interface CursorReadout {
  frequency: number;
  db: number;
  note: string;
  geqBand: number;
  bandLabel: string;
  trusted: boolean;
}

interface Props {
  engine: AnalyzerEngine;
  mode: PlotMode;
  showPeakHold: boolean;
  showNoiseFloor: boolean;
  /** Pink compensation for the FFT view: +3 dB/octave. */
  pinkCompensation: boolean;
  /** Target curve in dB per band, already level-matched. Phase 2 onwards. */
  target?: Float64Array | null;
  /** Long-window band levels to compare against the target. */
  useLongAverage?: boolean;
  /** Lowest frequency the microphone can be trusted at. */
  trustedFromHz: number;
  /** Highest frequency the microphone can be trusted at. */
  trustedToHz?: number;
  height?: number | string;
  onCursor?: (readout: CursorReadout | null) => void;
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}

const DB_SPAN = 70;
const F_MIN = 20;
const F_MAX = 20000;

/** Pink noise falls 3 dB per octave on a raw FFT; this puts it back flat. */
function pinkCompensationDb(f: number): number {
  return 10 * Math.log10(Math.max(f, 1) / 1000);
}

export function SpectrumPlot({
  engine,
  mode,
  showPeakHold,
  showNoiseFloor,
  pinkCompensation,
  target,
  useLongAverage = false,
  trustedFromHz,
  trustedToHz = 20000,
  height = 260,
  onCursor,
  canvasRef,
}: Props) {
  const rangeRef = useRef({ top: -10, settled: false });
  const cursorRef = useRef<number | null>(null);
  const [, force] = useState(0);

  const levelsFor = (s: EngineSnapshot): Float64Array =>
    useLongAverage && s.longFill > 0 ? s.longBandDb : s.bandDb;

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      clearPlot(ctx, w, h);
      const s = engine.snapshot;
      const levels = levelsFor(s);

      // Auto-range on the loudest *trustworthy* band so the picture is useful
      // without a calibrated level, but move slowly: a jumping axis is
      // unreadable. Bands below the microphone's range are excluded - they
      // carry corrected noise and would squash everything else.
      let loudest = -140;
      for (let b = 0; b < levels.length; b++) {
        if (s.bands[b].center < trustedFromHz) continue;
        const v = levels[b] + s.bandWeightingDb[b];
        if (v > loudest) loudest = v;
      }
      const wanted = Math.ceil((loudest + 8) / 5) * 5;
      const range = rangeRef.current;
      if (!range.settled && loudest > -140) {
        range.top = wanted;
        range.settled = true;
      } else {
        range.top += (wanted - range.top) * (wanted > range.top ? 0.25 : 0.02);
      }
      const dbMax = Math.round(range.top);
      const dbMin = dbMax - DB_SPAN;

      drawGrid(ctx, w, h, { fMin: F_MIN, fMax: F_MAX, dbMin, dbMax, dbStep: 10 });

      const untrustedColor = cssVar('--untrusted', '#4a5663');
      const trustedX = freqToX(trustedFromHz, F_MIN, F_MAX, w);
      if (trustedX > 1) {
        ctx.fillStyle = untrustedColor;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(0, 0, trustedX, h);
        ctx.globalAlpha = 1;
      }

      if (mode === 'rta') {
        drawBands(ctx, w, h, s, levels, dbMin, dbMax, trustedFromHz, trustedToHz, target ?? null);
        if (showPeakHold) drawPeakHold(ctx, w, h, s, dbMin, dbMax);
      } else {
        drawFft(ctx, w, h, s, dbMin, dbMax, pinkCompensation);
      }

      if (showNoiseFloor && s.noiseFloorDb) {
        ctx.strokeStyle = cssVar('--text-faint', '#5d6b79');
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let b = 0; b < s.bands.length; b++) {
          const x = freqToX(s.bands[b].center, F_MIN, F_MAX, w);
          const y = dbToY(s.noiseFloorDb[b] + s.bandWeightingDb[b], dbMin, dbMax, h);
          if (b === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (target) {
        ctx.strokeStyle = cssVar('--target', '#c9a227');
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let b = 0; b < s.bands.length; b++) {
          const x = freqToX(s.bands[b].center, F_MIN, F_MAX, w);
          const y = dbToY(target[b], dbMin, dbMax, h);
          if (b === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      drawDbLabels(ctx, h, { dbMin, dbMax, dbStep: 10 });

      const cursor = cursorRef.current;
      if (cursor !== null) {
        const x = freqToX(cursor, F_MIN, F_MAX, w);
        ctx.strokeStyle = cssVar('--accent', '#4ea8ff');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    },
    [
      engine,
      mode,
      pinkCompensation,
      showNoiseFloor,
      showPeakHold,
      target,
      trustedFromHz,
      trustedToHz,
      useLongAverage,
    ],
  );

  const handlePointer = useCallback(
    (info: PointerInfo) => {
      if (info.phase === 'up') {
        // Keep the cursor where it was released so the readout stays legible.
        return;
      }
      const f = xToFreq(info.x, F_MIN, F_MAX, info.width);
      cursorRef.current = f;
      force((n) => n + 1);
      if (!onCursor) return;
      const s = engine.snapshot;
      const levels = levelsFor(s);
      let nearest = 0;
      let bestDistance = Infinity;
      for (let b = 0; b < s.bands.length; b++) {
        const d = Math.abs(Math.log2(f / s.bands[b].center));
        if (d < bestDistance) {
          bestDistance = d;
          nearest = b;
        }
      }
      const bin = Math.round(f / (s.binWidth || 1));
      const db =
        mode === 'fft' && s.binPower.length > bin
          ? powerToDb(s.binPower[bin] * s.enbwBins) + (pinkCompensation ? pinkCompensationDb(f) : 0)
          : levels[nearest] + s.bandWeightingDb[nearest];
      onCursor({
        frequency: f,
        db,
        note: frequencyToNote(f)?.label ?? '',
        geqBand: nearestGeqBand(f, GEQ_31_BANDS),
        bandLabel: s.bands[nearest]?.label ?? formatFrequency(f),
        trusted: f >= trustedFromHz,
      });
    },
    [engine, mode, onCursor, pinkCompensation, trustedFromHz, useLongAverage],
  );

  return (
    <Canvas
      draw={draw}
      animate
      height={height}
      onPointer={handlePointer}
      ariaLabel="RTA"
      canvasRef={canvasRef}
    />
  );
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: EngineSnapshot,
  levels: Float64Array,
  dbMin: number,
  dbMax: number,
  trustedFromHz: number,
  trustedToHz: number,
  target: Float64Array | null,
): void {
  const trace = cssVar('--trace', '#8be04e');
  const untrusted = cssVar('--untrusted', '#4a5663');
  const excess = cssVar('--excess', '#ff5b5b');
  const deficit = cssVar('--deficit', '#4ea8ff');
  const zero = dbToY(dbMin, dbMin, dbMax, h);

  for (let b = 0; b < s.bands.length; b++) {
    const band = s.bands[b];
    const x0 = freqToX(band.lo, F_MIN, F_MAX, w);
    const x1 = freqToX(band.hi, F_MIN, F_MAX, w);
    const level = levels[b] + s.bandWeightingDb[b];
    const y = dbToY(level, dbMin, dbMax, h);
    const width = Math.max(1, x1 - x0 - 1);
    // Same rule the suggestions use, so the picture and the advice cannot
    // disagree: outside the microphone's range, or too close to the measured
    // noise floor, a band is not a measurement. In a quiet room this is what
    // separates "there is a lot of bass" from "that is the room's own rumble".
    const trusted =
      band.center >= trustedFromHz &&
      band.center <= trustedToHz &&
      (!s.noiseFloorDb || levels[b] >= s.noiseFloorDb[b] + MIN_SNR_DB);

    if (target) {
      // Colour by deviation so the eye lands on the problem, not the level.
      const deviation = level - target[b];
      ctx.fillStyle = !trusted ? untrusted : deviation > 0 ? excess : deficit;
      ctx.globalAlpha = Math.min(1, 0.35 + Math.abs(deviation) / 12);
    } else {
      ctx.fillStyle = trusted ? trace : untrusted;
      ctx.globalAlpha = 1;
    }
    ctx.fillRect(x0 + 0.5, Math.min(y, zero), width, Math.max(1, zero - y));
  }
  ctx.globalAlpha = 1;
}

function drawPeakHold(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: EngineSnapshot,
  dbMin: number,
  dbMax: number,
): void {
  ctx.fillStyle = cssVar('--text', '#e7edf3');
  for (let b = 0; b < s.bands.length; b++) {
    const band = s.bands[b];
    const x0 = freqToX(band.lo, F_MIN, F_MAX, w);
    const x1 = freqToX(band.hi, F_MIN, F_MAX, w);
    const y = dbToY(s.peakHoldDb[b] + s.bandWeightingDb[b], dbMin, dbMax, h);
    if (y < 0 || y > h) continue;
    ctx.fillRect(x0 + 0.5, y, Math.max(1, x1 - x0 - 1), 2);
  }
}

function drawFft(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: EngineSnapshot,
  dbMin: number,
  dbMax: number,
  pink: boolean,
): void {
  if (s.binCount === 0) return;
  ctx.strokeStyle = cssVar('--trace', '#8be04e');
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  let started = false;
  // One point per pixel column: at 32k FFT there are far more bins than
  // pixels, and drawing them all costs frames for nothing.
  let lastX = -1;
  let columnMax = -Infinity;
  for (let k = 1; k < s.binCount; k++) {
    const f = k * s.binWidth;
    if (f < F_MIN) continue;
    if (f > F_MAX) break;
    const x = Math.round(freqToX(f, F_MIN, F_MAX, w));
    const db = powerToDb(s.binPower[k] * s.enbwBins) + (pink ? pinkCompensationDb(f) : 0);
    if (x === lastX) {
      if (db > columnMax) columnMax = db;
      continue;
    }
    if (lastX >= 0) {
      const y = dbToY(columnMax, dbMin, dbMax, h);
      if (!started) {
        ctx.moveTo(lastX, y);
        started = true;
      } else {
        ctx.lineTo(lastX, y);
      }
    }
    lastX = x;
    columnMax = db;
  }
  ctx.stroke();
}
