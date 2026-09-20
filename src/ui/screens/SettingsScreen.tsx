import { useState } from 'react';
import { useEngine } from '../useEngine';
import { LOCALES, useI18n, type Locale } from '../../i18n';
import { useTheme, type Theme } from '../theme';
import { Segmented } from '../components/Controls';
import { FFT_SIZES } from '../../dsp/engine';
import { WINDOW_TYPES, type WindowType } from '../../dsp/windows';
import { WEIGHTINGS, type Weighting } from '../../dsp/weighting';
import { BUILTIN_PROFILES } from '../../data/mic-profiles';
import { ANDROID_UNPROCESSED_SPL_AT_0DBFS } from '../../dsp/calibration';
import { CalibrationCard } from '../components/CalibrationCard';
import { useLibrary } from '../useLibrary';
import { Toggle } from '../components/Controls';

export function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const { engine, settings, update, devices, deviceId, setDeviceId, refreshDevices, running } =
    useEngine();
  const { customMicProfiles } = useLibrary();
  const [theme, setTheme] = useTheme();
  const [knownSpl, setKnownSpl] = useState('');

  const profile = settings.micProfile;
  const allProfiles = [...BUILTIN_PROFILES, ...customMicProfiles];

  const applyCalibration = () => {
    const target = Number(knownSpl);
    if (!Number.isFinite(target)) return;
    // The offset is what turns the current dBFS reading into the known SPL.
    const current = engine.snapshot.levels.zDb;
    update({ levelCalibration: { splAt0dBFS: target - current } });
    setKnownSpl('');
  };

  return (
    <div className="screen">
      <h1>{t.settings.title}</h1>

      <div className="card col">
        <div className="card__title">{t.settings.capture}</div>
        <label className="field">
          {t.settings.device}
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={running}
            onFocus={() => void refreshDevices()}
          >
            <option value="">default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row row--between">
          <span className="small muted">{t.settings.fftSize}</span>
          <Segmented
            value={settings.fftSize}
            onChange={(fftSize: number) => update({ fftSize })}
            options={FFT_SIZES.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.settings.window}</span>
          <select
            value={settings.windowType}
            onChange={(e) => update({ windowType: e.target.value as WindowType })}
          >
            {WINDOW_TYPES.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="row row--between">
          <span className="small muted">{t.settings.overlap}</span>
          <Segmented
            value={settings.overlap}
            onChange={(overlap: number) => update({ overlap })}
            options={[
              { value: 0.5, label: '50%' },
              { value: 0.75, label: '75%' },
            ]}
          />
        </div>
      </div>

      <div className="card col">
        <div className="card__title">{t.settings.analysis}</div>
        <div className="row row--between">
          <span className="small muted">{t.settings.weighting}</span>
          <Segmented
            value={settings.weighting}
            onChange={(weighting: Weighting) => update({ weighting })}
            options={WEIGHTINGS.map((w) => ({ value: w, label: w }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.multires.label}</span>
          <Toggle
            checked={settings.multiResolution}
            onChange={(multiResolution) => update({ multiResolution })}
            label={settings.multiResolution ? t.common.on : t.common.off}
          />
        </div>
        <div className="faint small">
          {settings.multiResolution && engine.snapshot.lowBandFftSize > 0
            ? t.multires.hint(engine.snapshot.lowBandCrossoverHz, engine.snapshot.lowBandFftSize)
            : t.multires.off}
        </div>
        <label className="field">
          {t.settings.peakDecay}
          <input
            type="number"
            min={1}
            max={60}
            value={settings.peakDecayDbPerSecond}
            onChange={(e) => update({ peakDecayDbPerSecond: Number(e.target.value) || 12 })}
          />
        </label>
      </div>

      <div className="card col">
        <div className="card__title">{t.settings.microphone}</div>
        <label className="field">
          {t.settings.profile}
          <select
            value={profile?.id ?? ''}
            onChange={(e) =>
              update({ micProfile: allProfiles.find((p) => p.id === e.target.value) ?? null })
            }
          >
            <option value="">{t.settings.profileNone}</option>
            {allProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {profile?.approximate && <div className="note note--warn small">{t.settings.approximateWarning}</div>}
        {profile && (
          <div className="small faint">
            {t.settings.trustedRange(profile.trustedFromHz, profile.trustedToHz)}
          </div>
        )}
      </div>

      <CalibrationCard />

      <div className="card col">
        <div className="card__title">{t.settings.levelCalibration}</div>
        {settings.levelCalibration.splAt0dBFS === null ? (
          <div className="note small">{t.settings.notCalibrated}</div>
        ) : (
          <div className="small">
            {t.settings.splAt0dbfs}: <span className="mono">{settings.levelCalibration.splAt0dBFS.toFixed(1)}</span>
          </div>
        )}
        <p className="small muted">{t.settings.calibrateHint}</p>
        <div className="row">
          <input
            type="number"
            inputMode="decimal"
            placeholder={t.settings.knownSpl}
            value={knownSpl}
            onChange={(e) => setKnownSpl(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <button onClick={applyCalibration} disabled={!running || knownSpl === ''}>
            {t.settings.applyCalibration}
          </button>
          <button
            className="btn--ghost btn--small"
            onClick={() => update({ levelCalibration: { splAt0dBFS: null } })}
          >
            {t.settings.clearCalibration}
          </button>
        </div>
        <button
          className="btn--ghost btn--small"
          onClick={() =>
            update({ levelCalibration: { splAt0dBFS: ANDROID_UNPROCESSED_SPL_AT_0DBFS } })
          }
        >
          {t.settings.androidPreset} ({ANDROID_UNPROCESSED_SPL_AT_0DBFS} dB)
        </button>
      </div>

      <div className="card col">
        <div className="card__title">{t.settings.appearance}</div>
        <div className="row row--between">
          <span className="small muted">{t.settings.language}</span>
          <Segmented
            value={locale}
            onChange={(l: Locale) => setLocale(l)}
            options={(Object.keys(LOCALES) as Locale[]).map((l) => ({
              value: l,
              label: LOCALES[l].name,
            }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.settings.theme}</span>
          <Segmented
            value={theme}
            onChange={(th: Theme) => setTheme(th)}
            options={[
              { value: 'dark' as Theme, label: t.settings.themeDark },
              { value: 'night' as Theme, label: t.settings.themeNight },
            ]}
          />
        </div>
      </div>

      <div className="card">
        <div className="card__title">{t.settings.about}</div>
        <p className="small muted">{t.settings.aboutText}</p>
      </div>
    </div>
  );
}
