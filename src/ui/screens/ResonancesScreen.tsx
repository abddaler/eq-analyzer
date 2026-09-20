import { useEngine, useEngineTick } from '../useEngine';
import { useT } from '../../i18n';
import { formatFrequency, GEQ_31_BANDS } from '../../dsp/octave';
import { frequencyToNote, nearestGeqBand } from '../../dsp/notes';
import type { Resonance } from '../../dsp/peaks';

function Row({ r, live }: { r: Resonance; live: boolean }) {
  const t = useT();
  const note = frequencyToNote(r.frequency);
  return (
    <div className="card" style={{ borderLeft: `3px solid ${live ? 'var(--bad)' : 'var(--line-strong)'}` }}>
      <div className="row row--between">
        <strong className="mono">{formatFrequency(r.frequency)} {t.common.hz}</strong>
        <span className="badge badge--warn">
          +{r.prominenceDb.toFixed(0)} {t.common.db} {t.resonances.prominence}
        </span>
      </div>
      <div className="small muted">
        {note?.label} · {t.resonances.geqBand} {formatFrequency(nearestGeqBand(r.frequency, GEQ_31_BANDS))} ·{' '}
        {t.resonances.held} {t.resonances.ms(r.durationMs)}
      </div>
    </div>
  );
}

export function ResonancesScreen() {
  const t = useT();
  const { engine, running, start, stop, settings, update } = useEngine();
  useEngineTick(250);

  const active = engine.snapshot.resonances;
  const history = engine.resonanceHistory;

  return (
    <div className="screen">
      <div className="card col">
        <div className="row row--between">
          <button className="btn--primary" onClick={running ? stop : start}>
            {running ? t.common.stop : t.common.start}
          </button>
          <button className="btn--ghost btn--small" onClick={() => engine.resetResonances()}>
            {t.resonances.clear}
          </button>
        </div>
        <div className="row">
          <label className="field grow">
            {t.resonances.threshold}
            <input
              type="number"
              min={4}
              max={30}
              value={settings.resonanceThresholdDb}
              onChange={(e) => update({ resonanceThresholdDb: Number(e.target.value) || 10 })}
            />
          </label>
          <label className="field grow">
            {t.resonances.minDuration}
            <input
              type="number"
              min={100}
              max={5000}
              step={50}
              value={settings.resonanceMinDurationMs}
              onChange={(e) => update({ resonanceMinDurationMs: Number(e.target.value) || 300 })}
            />
          </label>
        </div>
        <div className="faint small">{t.resonances.hint}</div>
      </div>

      <div>
        <h2>{t.resonances.active}</h2>
        <div className="suggestions">
          {!running ? (
            <div className="note">{t.resonances.notRunning}</div>
          ) : active.length === 0 ? (
            <div className="note note--ok">{t.resonances.none}</div>
          ) : (
            active.map((r) => <Row key={r.id} r={r} live />)
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <h2>{t.resonances.history}</h2>
          <div className="suggestions">
            {history.map((r) => (
              <Row key={r.id} r={r} live={false} />
            ))}
          </div>
        </div>
      )}

      <div className="note">{t.resonances.ringOutTip}</div>
    </div>
  );
}
