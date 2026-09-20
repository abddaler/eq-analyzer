import { useCallback, useRef } from 'react';
import type { AnalyzerEngine } from '../../dsp/engine';
import { powerToDb } from '../../dsp/spectrum';
import { Canvas } from './Canvas';
import { freqToX, xToFreq } from '../plot';
import { cssVar } from '../theme';

const F_MIN = 20;
const F_MAX = 20000;
/** New rows appear at this rate regardless of the display refresh rate. */
const ROW_INTERVAL_MS = 50;

/** Level ramp: dark -> blue -> green -> yellow -> red. */
const RAMP: [number, number, number][] = [
  [8, 10, 14],
  [20, 40, 90],
  [20, 120, 140],
  [40, 180, 90],
  [220, 200, 60],
  [240, 90, 50],
  [255, 230, 220],
];

function rampColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

interface Props {
  engine: AnalyzerEngine;
  /** Level at the bottom of the colour ramp, relative to the loudest band. */
  dynamicRangeDb?: number;
  height?: number | string;
}

/**
 * Waterfall display: time flows downwards, frequency across, colour is level.
 *
 * The picture is kept on an offscreen canvas and scrolled by one row at a
 * fixed interval, so the history does not speed up or slow down with the
 * display refresh rate - which matters when comparing how long something rang.
 */
export function Spectrogram({ engine, dynamicRangeDb = 60, height = '45vh' }: Props) {
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const lastRowRef = useRef(0);
  const topDbRef = useRef(-20);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      // Keep the history at device resolution: upscaling a CSS-pixel buffer
      // turns thin resonance stripes into mush on a high-DPI phone.
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(w * dpr));
      const heightPx = Math.max(1, Math.round(h * dpr));
      let off = offRef.current;
      if (!off || off.width !== width || off.height !== heightPx) {
        off = document.createElement('canvas');
        off.width = width;
        off.height = heightPx;
        const c = off.getContext('2d');
        if (c) {
          c.fillStyle = cssVar('--bg-sunken', '#070809');
          c.fillRect(0, 0, width, heightPx);
        }
        offRef.current = off;
      }
      const offCtx = off.getContext('2d');
      if (!offCtx) return;

      const s = engine.snapshot;
      const now = performance.now();
      if (s.binCount > 0 && !s.frozen && now - lastRowRef.current >= ROW_INTERVAL_MS) {
        lastRowRef.current = now;

        // Track the loudest band slowly so the colours stay meaningful as the
        // show gets louder, without the whole picture flashing.
        let loudest = -140;
        for (let b = 0; b < s.bandDb.length; b++) {
          if (s.bandDb[b] > loudest) loudest = s.bandDb[b];
        }
        if (loudest > -140) {
          topDbRef.current += (loudest + 5 - topDbRef.current) * (loudest + 5 > topDbRef.current ? 0.2 : 0.02);
        }
        const top = topDbRef.current;
        const bottom = top - dynamicRangeDb;

        const row = offCtx.createImageData(width, 1);
        for (let x = 0; x < width; x++) {
          const f = xToFreq(x + 0.5, F_MIN, F_MAX, width);
          const bin = Math.round(f / (s.binWidth || 1));
          const db =
            bin > 0 && bin < s.binCount ? powerToDb(s.binPower[bin] * s.enbwBins) : -140;
          const [r, g, b] = rampColor((db - bottom) / (top - bottom));
          const o = x * 4;
          row.data[o] = r;
          row.data[o + 1] = g;
          row.data[o + 2] = b;
          row.data[o + 3] = 255;
        }

        // Scroll down one pixel, then write the new row at the top.
        offCtx.globalCompositeOperation = 'copy';
        offCtx.drawImage(off, 0, 1);
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.putImageData(row, 0, 0);
      }

      ctx.drawImage(off, 0, 0, w, h);

      // Frequency gridlines on top, so the picture stays readable.
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = Math.round(freqToX(f, F_MIN, F_MAX, w)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, h - 3);
      }
    },
    [dynamicRangeDb, engine],
  );

  return <Canvas draw={draw} animate height={height} ariaLabel="spectrogram" />;
}
