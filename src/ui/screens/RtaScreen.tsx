import { useCallback, useState } from 'react';
import { useEngine, useEngineTick } from '../useEngine';
import { useT } from '../../i18n';
import { SpectrumPlot, type CursorReadout, type PlotMode } from '../components/SpectrumPlot';
import { Segmented, Toggle } from '../components/Controls';
import { OCTAVE_FRACTIONS, formatFrequency, type OctaveFraction } from '../../dsp/octave';
import { LONG_WINDOW_SECONDS, type AveragingMode } from '../../dsp/engine';

export function RtaScreen() {
  const t = useT();
  const { engine, running, starting, error, start, stop, settings, update, frozen, setFrozen } =
    useEngine();
  useEngineTick(120);

  const [mode, setMode] = useState<PlotMode>('rta');
  const [pinkComp, setPinkComp] = useState(false);
  const [cursor, setCursor] = useState<CursorReadout | null>(null);

  const s = engine.snapshot;
  const trustedFrom = settings.micProfile?.trustedFromHz ?? 20;
  const onCursor = useCallback((c: CursorReadout | null) => setCursor(c), []);

  const levelText = s.levels.spl !== null
    ? `${s.levels.spl.toFixed(1)} ${t.rta.spl}`
    : `${s.levels.zDb.toFixed(1)} ${t.rta.relative}`;

  return (
    <div className="screen">
      {error && <div className="note note--bad">{error}</div>}

      <div className="card">
        <div className="row row--between">
          <div className="row">
            <button className="btn--primary" onClick={running ? stop : start} disabled={starting}>
              {running ? t.common.stop : t.common.start}
            </button>
            <button onClick={() => setFrozen(!frozen)} disabled={!running}>
              {frozen ? t.common.unfreeze : t.common.freeze}
            </button>
            <button className="btn--ghost" onClick={() => engine.resetAveraging()} disabled={!running}>
              {t.rta.resetAveraging}
            </button>
          </div>
          <div className="row">
            <span className="mono">{levelText}</span>
            {s.levels.clipping && <span className="badge badge--bad">{t.rta.clip}</span>}
            <span className="faint small nowrap">{t.rta.accumulated(s.elapsedSeconds)}</span>
          </div>
        </div>
      </div>

      {!running && <div className="note">{t.rta.startHint}</div>}

      <div className="canvas-wrap">
        <SpectrumPlot
          engine={engine}
          mode={mode}
          showPeakHold={settings.peakHoldEnabled && mode === 'rta'}
          showNoiseFloor
          pinkCompensation={pinkComp && mode === 'fft'}
          trustedFromHz={trustedFrom}
          height="40vh"
          onCursor={onCursor}
        />
      </div>

      <div className="card">
        <div className="card__title">
          <span>{t.rta.cursor}</span>
          {cursor ? (
            <span className="mono small">
              {formatFrequency(cursor.frequency)} {t.common.hz} · {cursor.db.toFixed(1)}{' '}
              {t.common.db} · {cursor.note} · {t.rta.geqBand} {formatFrequency(cursor.geqBand)}
            </span>
          ) : (
            <span className="faint small">{t.rta.cursorHint}</span>
          )}
        </div>
        {cursor && !cursor.trusted && (
          <div className="note note--warn small">{t.rta.untrustedBelow(trustedFrom)}</div>
        )}
      </div>

      <div className="card col">
        <div className="row row--between">
          <span className="small muted">{t.rta.mode}</span>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'rta', label: t.rta.modeRta },
              { value: 'fft', label: t.rta.modeFft },
            ]}
          />
        </div>
        {mode === 'fft' && (
          <div className="row row--between">
            <span className="small muted">{t.rta.pinkComp}</span>
            <Toggle checked={pinkComp} onChange={setPinkComp} label={pinkComp ? t.common.on : t.common.off} />
          </div>
        )}
        <div className="row row--between">
          <span className="small muted">{t.rta.fraction}</span>
          <Segmented
            value={settings.fraction}
            onChange={(fraction: OctaveFraction) => update({ fraction })}
            options={OCTAVE_FRACTIONS.map((f) => ({ value: f, label: t.rta.fractionValue(f) }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.rta.averaging}</span>
          <Segmented
            value={settings.averaging}
            onChange={(averaging: AveragingMode) => update({ averaging })}
            options={[
              { value: 'fast' as AveragingMode, label: t.rta.avgFast },
              { value: 'slow' as AveragingMode, label: t.rta.avgSlow },
              { value: 'infinite' as AveragingMode, label: t.rta.avgInfinite },
            ]}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.rta.longWindow}</span>
          <Segmented
            value={settings.longWindowSeconds}
            onChange={(longWindowSeconds: number) => update({ longWindowSeconds })}
            options={LONG_WINDOW_SECONDS.map((v) => ({ value: v, label: t.common.seconds(v) }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.rta.peakHold}</span>
          <Toggle
            checked={settings.peakHoldEnabled}
            onChange={(peakHoldEnabled) => update({ peakHoldEnabled })}
            label={settings.peakHoldEnabled ? t.common.on : t.common.off}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.rta.noiseFloor}</span>
          <div className="row">
            {s.noiseMeasureLeft > 0 ? (
              <span className="small">{t.rta.measuringNoise(s.noiseMeasureLeft)}</span>
            ) : (
              <button className="btn--small" onClick={() => engine.measureNoiseFloor()} disabled={!running}>
                {t.rta.measureNoise}
              </button>
            )}
            {s.noiseFloorDb && (
              <button className="btn--small btn--ghost" onClick={() => engine.clearNoiseFloor()}>
                {t.rta.clearNoise}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
