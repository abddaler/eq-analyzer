import { useMemo, useState } from 'react';
import { useEngine, useEngineTick } from '../useEngine';
import { useLibrary, snapshotOnBands } from '../useLibrary';
import { useT } from '../../i18n';
import { Canvas } from '../components/Canvas';
import { clearPlot, dbToY, drawGrid, freqToX } from '../plot';
import { cssVar } from '../theme';
import { exportBandsCsv } from '../export';
import { formatFrequency } from '../../dsp/octave';
import type { StoredSnapshot } from '../../storage/db';

const F_MIN = 20;
const F_MAX = 20000;

export function SnapshotsScreen() {
  const t = useT();
  const { engine, running, settings } = useEngine();
  const { snapshots, available, saveSnapshot, removeSnapshot, saveTarget } = useLibrary();
  useEngineTick(300);

  const [name, setName] = useState('');
  const [comparedId, setComparedId] = useState<string | null>(null);
  const compared = snapshots.find((s) => s.id === comparedId) ?? null;

  const s = engine.snapshot;

  const difference = useMemo(() => {
    if (!compared || s.bands.length === 0) return null;
    const stored = snapshotOnBands(compared, s.bands);
    const current = s.longFill > 0 ? s.longBandDb : s.bandDb;
    // Match levels over 500 Hz - 2 kHz so the comparison is about shape.
    let sumA = 0;
    let sumB = 0;
    let count = 0;
    for (let b = 0; b < s.bands.length; b++) {
      const f = s.bands[b].center;
      if (f < 500 || f > 2000) continue;
      sumA += current[b];
      sumB += stored[b];
      count++;
    }
    const offset = count ? sumA / count - sumB / count : 0;
    const diff = new Float64Array(s.bands.length);
    const aligned = new Float64Array(s.bands.length);
    for (let b = 0; b < s.bands.length; b++) {
      aligned[b] = stored[b] + offset;
      diff[b] = current[b] - aligned[b];
    }
    return { aligned, diff, current };
  }, [compared, s.bandDb, s.bands, s.longBandDb, s.longFill]);

  const save = async () => {
    if (s.bands.length === 0) return;
    await saveSnapshot({
      name: name.trim() || new Date().toLocaleString(),
      sampleRate: s.sampleRate,
      fraction: settings.fraction,
      bandCenters: s.bands.map((b) => b.center),
      bandDb: Array.from(s.bandDb),
      longBandDb: Array.from(s.longBandDb),
      noiseFloorDb: s.noiseFloorDb ? Array.from(s.noiseFloorDb) : null,
      micProfileId: settings.micProfile?.id ?? null,
      splAt0dBFS: settings.levelCalibration.splAt0dBFS,
      weighting: settings.weighting,
    });
    setName('');
  };

  const useAsTarget = async (snapshot: StoredSnapshot) => {
    const points = snapshot.bandCenters.map((f, i) => ({
      f,
      db: snapshot.longBandDb[i] ?? snapshot.bandDb[i],
    }));
    const stored = await saveTarget(snapshot.name, points);
    if (stored) {
      try {
        localStorage.setItem('eqscope.target', stored.id);
      } catch {
        // ignore
      }
    }
  };

  const drawComparison = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    clearPlot(ctx, w, h);
    if (!difference || s.bands.length === 0) return;
    const dbMin = -15;
    const dbMax = 15;
    drawGrid(ctx, w, h, { fMin: F_MIN, fMax: F_MAX, dbMin, dbMax, dbStep: 5 });

    const zeroY = dbToY(0, dbMin, dbMax, h);
    ctx.strokeStyle = cssVar('--target', '#c9a227');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    for (let b = 0; b < s.bands.length; b++) {
      const band = s.bands[b];
      const x0 = freqToX(band.lo, F_MIN, F_MAX, w);
      const x1 = freqToX(band.hi, F_MIN, F_MAX, w);
      const value = Math.max(dbMin, Math.min(dbMax, difference.diff[b]));
      const y = dbToY(value, dbMin, dbMax, h);
      ctx.fillStyle = value >= 0 ? cssVar('--excess', '#ff5b5b') : cssVar('--deficit', '#4ea8ff');
      ctx.fillRect(x0 + 0.5, Math.min(y, zeroY), Math.max(1, x1 - x0 - 1), Math.abs(zeroY - y));
    }
  };

  return (
    <div className="screen">
      <h1>{t.snapshots.title}</h1>
      <div className="faint small">{t.snapshots.hint}</div>
      {!available && <div className="note note--bad">{t.snapshots.storageError}</div>}

      <div className="card col">
        <div className="row">
          <input
            type="text"
            className="grow"
            placeholder={t.snapshots.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn--primary" onClick={save} disabled={!running}>
            {t.snapshots.save}
          </button>
        </div>
        {!running && <div className="small faint">{t.snapshots.notRunning}</div>}
      </div>

      {compared && difference && (
        <div className="card col">
          <div className="card__title">
            <span>
              {t.snapshots.difference}: {compared.name}
            </span>
            <button className="btn--small btn--ghost" onClick={() => setComparedId(null)}>
              {t.snapshots.stopCompare}
            </button>
          </div>
          <div className="canvas-wrap">
            <Canvas draw={drawComparison} animate height={200} ariaLabel={t.snapshots.difference} />
          </div>
          <div className="faint small mono">
            {s.bands
              .map((band, b) => ({ band, v: difference.diff[b] }))
              .filter(({ v }) => Math.abs(v) >= 3)
              .slice(0, 6)
              .map(({ band, v }) => `${formatFrequency(band.nominal)}: ${v > 0 ? '+' : ''}${v.toFixed(1)}`)
              .join('   ')}
          </div>
        </div>
      )}

      <div className="suggestions">
        {snapshots.length === 0 ? (
          <div className="note">{t.snapshots.none}</div>
        ) : (
          snapshots.map((snapshot) => (
            <div className="card col" key={snapshot.id}>
              <div className="row row--between">
                <strong>{snapshot.name}</strong>
                <span className="faint small">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="row">
                <button
                  className="btn--small"
                  onClick={() => setComparedId(snapshot.id === comparedId ? null : snapshot.id)}
                >
                  {snapshot.id === comparedId ? t.snapshots.stopCompare : t.snapshots.compare}
                </button>
                <button className="btn--small btn--ghost" onClick={() => void useAsTarget(snapshot)}>
                  {t.snapshots.useAsTarget}
                </button>
                <button
                  className="btn--small btn--ghost"
                  onClick={() =>
                    exportBandsCsv(
                      snapshot.bandCenters.map((f, i) => ({
                        center: f,
                        lo: f / Math.pow(2, 1 / (2 * snapshot.fraction)),
                        hi: f * Math.pow(2, 1 / (2 * snapshot.fraction)),
                        nominal: Math.round(f),
                        label: formatFrequency(f),
                        index: i,
                      })),
                      [
                        { header: 'level_db', values: snapshot.bandDb },
                        { header: 'long_avg_db', values: snapshot.longBandDb },
                        { header: 'noise_db', values: snapshot.noiseFloorDb },
                      ],
                      `snapshot-${snapshot.name.replace(/\s+/g, '-')}`,
                    )
                  }
                >
                  {t.snapshots.exportCsv}
                </button>
                <button
                  className="btn--small btn--ghost"
                  onClick={() => {
                    if (confirm(t.snapshots.deleteConfirm)) void removeSnapshot(snapshot.id);
                  }}
                >
                  {t.common.delete}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
