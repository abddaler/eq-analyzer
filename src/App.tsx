import { useEffect, useState } from 'react';
import './ui/styles.css';
import { useT } from './i18n';
import { useTheme } from './ui/theme';
import { useEngine } from './ui/useEngine';
import { RtaScreen } from './ui/screens/RtaScreen';
import { SpectrogramScreen } from './ui/screens/SpectrogramScreen';
import { ResonancesScreen } from './ui/screens/ResonancesScreen';
import { SnapshotsScreen } from './ui/screens/SnapshotsScreen';
import { GeneratorScreen } from './ui/screens/GeneratorScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { DiagnosticsScreen } from './ui/screens/DiagnosticsScreen';
import type { Dict } from './i18n/ru';

type ScreenId =
  | 'rta'
  | 'spectrogram'
  | 'resonances'
  | 'snapshots'
  | 'generator'
  | 'settings'
  | 'diagnostics';

interface ScreenDef {
  id: ScreenId;
  icon: string;
  label: (t: Dict) => string;
  render: () => React.ReactNode;
  /** Diagnostics opens its own capture, so the main engine must let go first. */
  exclusiveCapture?: boolean;
}

const SCREENS: ScreenDef[] = [
  { id: 'rta', icon: '📊', label: (t) => t.nav.rta, render: () => <RtaScreen /> },
  {
    id: 'spectrogram',
    icon: '🌊',
    label: (t) => t.nav.spectrogram,
    render: () => <SpectrogramScreen />,
  },
  {
    id: 'resonances',
    icon: '🔔',
    label: (t) => t.nav.resonances,
    render: () => <ResonancesScreen />,
  },
  { id: 'snapshots', icon: '📁', label: (t) => t.nav.snapshots, render: () => <SnapshotsScreen /> },
  { id: 'generator', icon: '〰️', label: (t) => t.nav.generator, render: () => <GeneratorScreen /> },
  { id: 'settings', icon: '⚙️', label: (t) => t.nav.settings, render: () => <SettingsScreen /> },
  {
    id: 'diagnostics',
    icon: '🩺',
    label: (t) => t.nav.diagnostics,
    render: () => <DiagnosticsScreen />,
    exclusiveCapture: true,
  },
];

export function App() {
  const t = useT();
  const [screen, setScreen] = useState<ScreenId>('rta');
  const [theme, setTheme] = useTheme();
  const { running, stop } = useEngine();
  const active = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

  // Two capture sessions on one microphone fight each other on mobile Safari.
  useEffect(() => {
    if (active.exclusiveCapture && running) void stop();
  }, [active, running, stop]);

  return (
    <div className="app">
      <div className="app__body">{active.render()}</div>
      <nav className="nav">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            className={`nav__item${s.id === screen ? ' nav__item--active' : ''}`}
            onClick={() => setScreen(s.id)}
          >
            <span className="nav__icon">{s.icon}</span>
            {s.label(t)}
          </button>
        ))}
        <button
          className="nav__item"
          onClick={() => setTheme(theme === 'night' ? 'dark' : 'night')}
          aria-label="theme"
        >
          <span className="nav__icon">{theme === 'night' ? '🌙' : '🌑'}</span>
          {theme === 'night' ? 'night' : 'dark'}
        </button>
      </nav>
    </div>
  );
}
