import { useEffect, useState } from 'react';
import { useEngine } from '../useEngine';
import { useT } from '../../i18n';

interface Sample {
  fps: number;
  engineFps: number;
  heapMb: number | null;
}

/**
 * Frame-rate and memory readout.
 *
 * The acceptance criteria are "at least 30 FPS" and "no memory growth over
 * 30 minutes", and neither can be checked from a desk - this makes both
 * visible on the device itself.
 */
export function PerfMeter() {
  const t = useT();
  const { engine, running } = useEngine();
  const [sample, setSample] = useState<Sample>({ fps: 0, engineFps: 0, heapMb: null });

  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let last = performance.now();
    let lastEngineFrames = engine.snapshot.frames;

    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        const seconds = (now - last) / 1000;
        const engineFrames = engine.snapshot.frames;
        // performance.memory is Chromium-only; absent everywhere else.
        const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
        setSample({
          fps: frames / seconds,
          engineFps: (engineFrames - lastEngineFrames) / seconds,
          heapMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : null,
        });
        frames = 0;
        lastEngineFrames = engineFrames;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const fpsClass = sample.fps >= 30 ? 'ok' : sample.fps >= 20 ? 'warn' : 'bad';

  return (
    <div className="card">
      <div className="card__title">
        <span>{t.perf.title}</span>
        <span className={`badge badge--${running ? fpsClass : 'neutral'}`}>
          {sample.fps.toFixed(0)} FPS
        </span>
      </div>
      <dl className="kv">
        <dt>{t.perf.fps}</dt>
        <dd className="mono">{sample.fps.toFixed(1)}</dd>
        <dt>{t.perf.engineFps}</dt>
        <dd className="mono">{sample.engineFps.toFixed(1)}</dd>
        <dt>{t.perf.heap}</dt>
        <dd className="mono">
          {sample.heapMb === null ? t.perf.heapUnavailable : `${sample.heapMb.toFixed(1)} MB`}
        </dd>
      </dl>
      <div className="faint small">{t.perf.hint}</div>
    </div>
  );
}
