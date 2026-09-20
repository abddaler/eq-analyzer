import type { Suggestion } from '../../analysis/suggest';
import { formatFrequency } from '../../dsp/octave';
import { useT } from '../../i18n';

export type SuggestMode = 'simple' | 'pro';

const CONFIDENCE_CLASS = { high: 'ok', medium: 'warn', low: 'bad' } as const;

export function SuggestionCard({ suggestion, mode }: { suggestion: Suggestion; mode: SuggestMode }) {
  const t = useT();
  const s = suggestion;
  const excess = s.direction === 'excess';
  const zoneName = t.zones[s.zone];
  const problem = excess ? t.zoneExcess[s.zone] : t.zoneDeficit[s.zone];
  const severityWord = s.severity === 'noticeable' ? t.suggest.noticeable : t.suggest.slight;
  const confidenceWord =
    s.confidence.level === 'high'
      ? t.suggest.confidenceHigh
      : s.confidence.level === 'medium'
        ? t.suggest.confidenceMedium
        : t.suggest.confidenceLow;

  return (
    <div className="card suggestion">
      <div className="row row--between">
        <div className="row">
          <span className="suggestion__arrow" style={{ color: excess ? 'var(--excess)' : 'var(--deficit)' }}>
            {excess ? '▼' : '▲'}
          </span>
          <strong>
            {mode === 'simple'
              ? `${excess ? t.suggest.cut : t.suggest.boost} ${t.zonesAccusative[s.zone]}`
              : zoneName}
          </strong>
          <span className="faint small">{severityWord}</span>
        </div>
        <span className={`badge badge--${CONFIDENCE_CLASS[s.confidence.level]}`}>
          {t.suggest.confidence}: {confidenceWord}
        </span>
      </div>

      <div className="small muted" style={{ marginTop: 4 }}>
        {t.suggest.range(Math.round(s.lowHz), Math.round(s.highHz))} ·{' '}
        {excess ? t.suggest.excessBy(Math.abs(s.deviationDb)) : t.suggest.deficitBy(Math.abs(s.deviationDb))} ·{' '}
        {problem}
      </div>

      {mode === 'pro' && (
        <div className="col" style={{ marginTop: 8, gap: 4 }}>
          <div className="row small">
            <span className="faint" style={{ minWidth: 92 }}>
              {t.suggest.parametric}
            </span>
            <span className="mono">
              {t.suggest.parametricValue(formatFrequency(s.centerHz), s.gainDb, s.q)}
            </span>
          </div>
          {s.geq.length > 0 && (
            <div className="row small">
              <span className="faint" style={{ minWidth: 92 }}>
                {t.suggest.geq}
              </span>
              <span className="mono">
                {s.geq
                  .map((g) => `${formatFrequency(g.hz)}: ${g.gainDb > 0 ? '+' : ''}${g.gainDb}`)
                  .join('  ')}
              </span>
            </div>
          )}
          <div className="faint small">
            {t.suggest.confidenceWhy(
              s.confidence.seconds,
              Number.isFinite(s.confidence.minSnrDb) ? s.confidence.minSnrDb : null,
              s.confidence.touchesUntrustedRange,
            )}
          </div>
        </div>
      )}
    </div>
  );
}
