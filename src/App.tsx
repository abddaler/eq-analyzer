import { useState } from 'react';
import './ui/styles.css';
import { useT } from './i18n';
import { useTheme } from './ui/theme';
import { DiagnosticsScreen } from './ui/screens/DiagnosticsScreen';

type ScreenId = 'diagnostics';

interface ScreenDef {
  id: ScreenId;
  icon: string;
  label: (t: ReturnType<typeof useT>) => string;
  render: () => React.ReactNode;
}

const SCREENS: ScreenDef[] = [
  {
    id: 'diagnostics',
    icon: '🩺',
    label: (t) => t.nav.diagnostics,
    render: () => <DiagnosticsScreen />,
  },
];

export function App() {
  const t = useT();
  const [screen, setScreen] = useState<ScreenId>('diagnostics');
  const [theme, setTheme] = useTheme();
  const active = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

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
