import { useCallback, useState } from 'react';
import { useEngine, useEngineTick } from '../useEngine';
import { useT } from '../../i18n';
import { SpectrumPlot, type CursorReadout, type PlotMode } from '../components/SpectrumPlot';
import { Segmented, Toggle } from '../components/Controls';
import { OCTAVE_FRACTIONS, formatFrequency, type OctaveFraction } from '../../dsp/octave';
import { LONG_WINDOW_SECONDS, type AveragingMode } from '../../dsp/engine';
import { useSuggestions } from '../useSuggestions';
import { SuggestionCard, type SuggestMode } from '../components/SuggestionCards';
import { BUILTIN_TARGETS } from '../../analysis/targets';
import type { Dict } from '../../i18n/ru';

const TARGET_KEY = 'eqscope.target';
const SUGGEST_MODE_KEY = 'eqscope.suggestMode';

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function targetName(t: Dict, id: string): string {
  return id === 'flat' || id === 'live' || id === 'speech' ? t.targets[id] : id;
}

export function RtaScreen() {
  const t = useT();
  const { engine, running, starting, error, start, stop, settings, update, frozen, setFrozen } =
    useEngine();
  useEngineTick(120);

  const [mode, setMode] = useState<PlotMode>('rta');
  const [pinkComp, setPinkComp] = useState(false);
  const [cursor, setCursor] = useState<CursorReadout | null>(null);
  const [targetId, setTargetId] = useState(() => stored(TARGET_KEY, 'live'));
  const [suggestMode, setSuggestMode] = useState<SuggestMode>(
    () => stored(SUGGEST_MODE_KEY, 'simple') as SuggestMode,
  );
  const { suggestions, targetDb, windowFill, ready } = useSuggestions(targetId);

  const chooseTarget = (id: string) => {
    setTargetId(id);
    try {
      localStorage.setItem(TARGET_KEY, id);
    } catch {
      // ignore
    }
  };

  const chooseSuggestMode = (m: SuggestMode) => {
    setSuggestMode(m);
    try {
      localStorage.setItem(SUGGEST_MODE_KEY, m);
    } catch {
      // ignore
    }
  };

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
          target={mode === 'rta' ? targetDb : null}
          useLongAverage
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
          <span className="small muted">{t.targets.label}</span>
          <select value={targetId} onChange={(e) => chooseTarget(e.target.value)}>
            {BUILTIN_TARGETS.map((c) => (
              <option key={c.id} value={c.id}>
                {targetName(t, c.id)}
              </option>
            ))}
          </select>
        </div>
        <div className="row row--between">
          <span className="small muted">{t.suggest.title}</span>
          <Segmented
            value={suggestMode}
            onChange={chooseSuggestMode}
            options={[
              { value: 'simple' as SuggestMode, label: t.suggest.modeSimple },
              { value: 'pro' as SuggestMode, label: t.suggest.modePro },
            ]}
          />
        </div>
        <div className="faint small">{t.targets.hint}</div>
      </div>

      <div className="suggestions">
        {!running ? (
          <div className="note">{t.suggest.notRunning}</div>
        ) : !ready ? (
          <div className="note">
            {t.suggest.warmingUp(windowFill * settings.longWindowSeconds, settings.longWindowSeconds)}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="note note--ok">{t.suggest.empty}</div>
        ) : (
          suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} mode={suggestMode} />)
        )}
        {running && ready && suggestions.length > 0 && (
          <div className="faint small">{t.suggest.disclaimer}</div>
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
