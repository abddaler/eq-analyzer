import { useState } from 'react';
import { useT } from '../../i18n';
import { useEngine } from '../useEngine';
import { useLibrary } from '../useLibrary';
import { parseCalibrationFile, type ParsedCalibration } from '../../dsp/cal-file';
import { profileFromComparison } from '../../dsp/calibration';

interface Capture {
  centers: number[];
  levelsDb: number[];
}

const WARNING_TEXT = (t: ReturnType<typeof useT>, warning: string, skipped: number): string => {
  switch (warning) {
    case 'empty':
      return t.calibration.warningEmpty;
    case 'missing-low-end':
      return t.calibration.warningLow;
    case 'missing-high-end':
      return t.calibration.warningHigh;
    case 'few-points':
      return t.calibration.warningFew;
    case 'skipped-lines':
      return t.calibration.warningSkipped(skipped);
    default:
      return warning;
  }
};

export function CalibrationCard() {
  const t = useT();
  const { engine, running } = useEngine();
  const { micProfiles, saveMicProfile, removeMicProfile } = useLibrary();

  const [parsed, setParsed] = useState<ParsedCalibration | null>(null);
  const [fileName, setFileName] = useState('');
  const [name, setName] = useState('');
  const [reference, setReference] = useState<Capture | null>(null);
  const [phone, setPhone] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    const result = parseCalibrationFile(text);
    setParsed(result);
    setFileName(file.name);
    setName((current) => current || file.name.replace(/\.[^.]+$/, ''));
  };

  const saveImported = async () => {
    if (!parsed || parsed.points.length === 0) return;
    await saveMicProfile({
      name: name.trim() || fileName || 'calibration',
      points: parsed.points.map((p) => ({ f: p.f, db: p.db })),
      // A file from a real measurement microphone is trustworthy across the
      // whole band it covers.
      trustedFromHz: Math.max(20, parsed.points[0].f),
      trustedToHz: Math.min(20000, parsed.points[parsed.points.length - 1].f),
      sensitivityDb: parsed.sensitivityDb ?? undefined,
      source: 'imported',
    });
    setParsed(null);
    setFileName('');
    setName('');
  };

  const capture = (): Capture | null => {
    const s = engine.snapshot;
    if (!running || s.bands.length === 0) return null;
    const levels = s.longFill > 0 ? s.longBandDb : s.bandDb;
    return { centers: s.bands.map((b) => b.center), levelsDb: Array.from(levels) };
  };

  const buildFromComparison = async () => {
    if (!reference || !phone) {
      setError(t.calibration.needBoth);
      return;
    }
    setError(null);
    // Both captures come from the same band layout, so the centres line up.
    const profile = profileFromComparison(
      'pending',
      name.trim() || 'phone',
      phone.centers,
      phone.levelsDb,
      reference.levelsDb,
    );
    await saveMicProfile({
      name: profile.name,
      points: profile.points.map((p) => ({ f: p.f, db: p.db })),
      trustedFromHz: 40,
      trustedToHz: 20000,
      source: 'measured',
    });
    setReference(null);
    setPhone(null);
    setName('');
  };

  return (
    <div className="card col">
      <div className="card__title">{t.calibration.title}</div>

      <div className="col">
        <strong className="small">{t.calibration.importFile}</strong>
        <p className="small muted">{t.calibration.importHint}</p>
        <input
          type="file"
          accept=".txt,.cal,.frd,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        {parsed && (
          <div className="col">
            <div className="small">{t.calibration.imported(parsed.points.length)}</div>
            {parsed.sensitivityDb !== null && (
              <div className="small faint">{t.calibration.sensitivity(parsed.sensitivityDb)}</div>
            )}
            {parsed.warnings.map((w) => (
              <div key={w} className="note note--warn small">
                {WARNING_TEXT(t, w, parsed.skippedLines)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="col">
        <strong className="small">{t.calibration.reference}</strong>
        <p className="small muted">{t.calibration.referenceHint}</p>
        {!running && <div className="note note--warn small">{t.calibration.needRunning}</div>}
        <div className="row">
          <button
            className="btn--small"
            disabled={!running}
            onClick={() => setReference(capture())}
          >
            {t.calibration.captureReference}
          </button>
          <span className={`badge badge--${reference ? 'ok' : 'neutral'}`}>
            {reference ? t.calibration.captured : t.calibration.notCaptured}
          </span>
        </div>
        <div className="row">
          <button className="btn--small" disabled={!running} onClick={() => setPhone(capture())}>
            {t.calibration.capturePhone}
          </button>
          <span className={`badge badge--${phone ? 'ok' : 'neutral'}`}>
            {phone ? t.calibration.captured : t.calibration.notCaptured}
          </span>
        </div>
      </div>

      <label className="field">
        {t.calibration.profileName}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={saveImported} disabled={!parsed || parsed.points.length === 0}>
          {t.calibration.saveProfile}
        </button>
        <button className="btn--ghost" onClick={buildFromComparison} disabled={!reference || !phone}>
          {t.calibration.buildProfile}
        </button>
      </div>
      {error && <div className="note note--bad small">{error}</div>}

      <div className="col">
        <strong className="small">{t.calibration.myProfiles}</strong>
        {micProfiles.length === 0 ? (
          <div className="faint small">{t.calibration.noProfiles}</div>
        ) : (
          micProfiles.map((p) => (
            <div className="row row--between" key={p.id}>
              <span className="small">
                {p.name} <span className="faint">({p.points.length})</span>
              </span>
              <button className="btn--small btn--ghost" onClick={() => void removeMicProfile(p.id)}>
                {t.common.delete}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
