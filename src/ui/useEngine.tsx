import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnalyzerEngine, DEFAULT_SETTINGS, type EngineSettings } from '../dsp/engine';
import { WebAudioSource } from '../audio/WebAudioSource';
import type { AudioDeviceOption } from '../audio/AudioSource';
import { BUILTIN_PROFILES } from '../data/mic-profiles';
import { useT } from '../i18n';

const SETTINGS_KEY = 'eqscope.settings';

/** Everything except the microphone profile, which is stored by id. */
type StoredSettings = Omit<EngineSettings, 'micProfile'> & { micProfileId: string | null };

function loadSettings(): EngineSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      const profile = BUILTIN_PROFILES.find((p) => p.id === parsed.micProfileId) ?? null;
      return { ...DEFAULT_SETTINGS, ...parsed, micProfile: profile };
    }
  } catch {
    // Corrupt or unavailable storage: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: EngineSettings): void {
  try {
    const { micProfile, ...rest } = settings;
    const stored: StoredSettings = { ...rest, micProfileId: micProfile?.id ?? null };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }
}

interface EngineContextValue {
  engine: AnalyzerEngine;
  source: WebAudioSource;
  running: boolean;
  starting: boolean;
  error: string | null;
  devices: AudioDeviceOption[];
  deviceId: string;
  setDeviceId: (id: string) => void;
  refreshDevices: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  settings: EngineSettings;
  update: (patch: Partial<EngineSettings>) => void;
  frozen: boolean;
  setFrozen: (frozen: boolean) => void;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const engineRef = useRef<AnalyzerEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AnalyzerEngine();
  const sourceRef = useRef<WebAudioSource | null>(null);
  if (!sourceRef.current) sourceRef.current = new WebAudioSource();
  const engine = engineRef.current;
  const source = sourceRef.current;

  const [settings, setSettings] = useState<EngineSettings>(loadSettings);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [frozen, setFrozenState] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    engine.update(settings);
    saveSettings(settings);
  }, [engine, settings]);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await source.listDevices());
    } catch {
      setDevices([]);
    }
  }, [source]);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      // Not on iOS Safari before 16.4; measuring simply keeps the usual
      // auto-lock behaviour there.
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      await source.start({ deviceId: deviceId || undefined, bufferSeconds: 6 });
      engine.attach(source);
      engine.update(settings);
      setRunning(true);
      void refreshDevices();
      void requestWakeLock();
    } catch (err) {
      const e = err as DOMException;
      setError(
        e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
          ? t.errors.micDenied
          : t.errors.micFailed(e?.message ?? String(err)),
      );
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }, [deviceId, engine, refreshDevices, requestWakeLock, settings, source, t]);

  const stop = useCallback(async () => {
    engine.detach();
    await source.stop();
    releaseWakeLock();
    setRunning(false);
  }, [engine, releaseWakeLock, source]);

  // Re-acquire the wake lock after the OS drops it on tab switch.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && running) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [requestWakeLock, running]);

  useEffect(() => {
    void refreshDevices();
    return () => {
      engine.detach();
      void source.stop();
      releaseWakeLock();
    };
  }, [engine, refreshDevices, releaseWakeLock, source]);

  const setFrozen = useCallback(
    (value: boolean) => {
      setFrozenState(value);
      engine.setFrozen(value);
    },
    [engine],
  );

  const update = useCallback((patch: Partial<EngineSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<EngineContextValue>(
    () => ({
      engine,
      source,
      running,
      starting,
      error,
      devices,
      deviceId,
      setDeviceId,
      refreshDevices,
      start,
      stop,
      settings,
      update,
      frozen,
      setFrozen,
    }),
    [
      deviceId,
      devices,
      engine,
      error,
      frozen,
      refreshDevices,
      running,
      setFrozen,
      settings,
      source,
      start,
      starting,
      stop,
      update,
    ],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside EngineProvider');
  return ctx;
}

/**
 * Re-render at a fixed, slow rate while the engine runs at audio cadence.
 *
 * Readouts only need ~10 Hz; graphs read engine.snapshot directly inside their
 * own animation frame and never go through React at all.
 */
export function useEngineTick(intervalMs = 100): number {
  const { engine } = useEngine();
  const [tick, setTick] = useState(0);
  const lastRef = useRef(0);

  useEffect(() => {
    return engine.subscribe(() => {
      const now = performance.now();
      if (now - lastRef.current >= intervalMs) {
        lastRef.current = now;
        setTick((n) => n + 1);
      }
    });
  }, [engine, intervalMs]);

  return tick;
}
