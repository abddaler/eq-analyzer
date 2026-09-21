import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebAudioSource } from '../../audio/WebAudioSource';
import type { AudioDeviceOption, AudioSourceInfo } from '../../audio/AudioSource';
import { encodeWav } from '../../audio/wav';
import { SpectrumAnalyzer, powerToDb } from '../../dsp/spectrum';
import { bandEnergy, makeBands, mapBinsToBands } from '../../dsp/octave';
import { analyseHighEnd, type HfResult } from '../../dsp/hf-check';
import { analyseLevelStability, type StabilityResult } from '../../dsp/stability';
import { useT } from '../../i18n';
import { Canvas } from '../components/Canvas';
import { clearPlot, drawGrid, freqToX, dbToY } from '../plot';
import { cssVar } from '../theme';
import { PerfMeter } from '../components/PerfMeter';

const FFT_SIZE = 8192;
const HF_CHECK_SECONDS = 5;
const STABILITY_SECONDS = 10;
const STABILITY_INTERVAL_MS = 200;
const RECORD_SECONDS = 10;

type Flag = boolean | null;

function FlagRow({ label, requested, applied }: { label: string; requested: Flag; applied: Flag }) {
  const t = useT();
  const good = applied === false;
  const unknown = applied === null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className={`badge badge--${unknown ? 'neutral' : good ? 'ok' : 'bad'}`}>
          {unknown ? t.common.unknown : applied ? t.common.on : t.common.off}
        </span>{' '}
        <span className="faint small">
          ({t.diagnostics.requested}: {requested ? t.common.on : t.common.off})
        </span>
      </dd>
    </>
  );
}

export function DiagnosticsScreen() {
  const t = useT();
  const sourceRef = useRef<WebAudioSource | null>(null);
  if (!sourceRef.current) sourceRef.current = new WebAudioSource();
  const source = sourceRef.current;

  const [info, setInfo] = useState<AudioSourceInfo | null>(null);
  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState({ rms: -120, peak: -120, clipped: false });
  const [hf, setHf] = useState<HfResult | null>(null);
  const [hfLeft, setHfLeft] = useState(0);
  const [recordLeft, setRecordLeft] = useState(0);
  const [stability, setStability] = useState<StabilityResult | null>(null);
  const [stabilityLeft, setStabilityLeft] = useState(0);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Live analysis state, kept out of React so the rAF loop never re-renders.
  const analyserRef = useRef<SpectrumAnalyzer | null>(null);
  const displayRef = useRef<Float64Array | null>(null);
  const frameRef = useRef(new Float32Array(FFT_SIZE));
  const nextFrameRef = useRef(0);
  const hfAccRef = useRef<{ acc: Float64Array; frames: number; until: number } | null>(null);
  const stabilityRef = useRef<{ samples: number[]; nextAt: number; until: number } | null>(null);
  const noiseRef = useRef<Float64Array | null>(null);

  const supported = WebAudioSource.isSupported();
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  const bands = useMemo(() => makeBands(3, 20, 20000), []);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await source.listDevices());
    } catch {
      setDevices([]);
    }
  }, [source]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const started = await source.start({ deviceId: deviceId || undefined, bufferSeconds: 12 });
      analyserRef.current = new SpectrumAnalyzer(FFT_SIZE, started.sampleRate, 'hann');
      displayRef.current = new Float64Array(analyserRef.current.bins);
      nextFrameRef.current = 0;
      setInfo(started);
      setRunning(true);
      void refreshDevices();
    } catch (err) {
      const e = err as DOMException;
      setError(
        e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
          ? t.errors.micDenied
          : t.errors.micFailed(e?.message ?? String(err)),
      );
    }
  }, [deviceId, refreshDevices, source, t]);

  const stop = useCallback(async () => {
    await source.stop();
    setRunning(false);
    setInfo(null);
    hfAccRef.current = null;
  }, [source]);

  useEffect(() => {
    void refreshDevices();
    return () => {
      void source.stop();
    };
  }, [refreshDevices, source]);

  useEffect(() => () => {
    if (wavUrl) URL.revokeObjectURL(wavUrl);
  }, [wavUrl]);

  // Single processing loop: pulls every available hop out of the ring buffer so
  // averaging and recording see a continuous stream, not screen refreshes.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastUi = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const buffer = source.buffer;
      const analyser = analyserRef.current;
      const display = displayRef.current;
      if (!buffer || !analyser || !display) return;

      const hop = FFT_SIZE / 2;
      if (nextFrameRef.current === 0) nextFrameRef.current = Math.max(0, buffer.written - FFT_SIZE);
      // Never chase more than a handful of frames after a stall.
      if (buffer.written - nextFrameRef.current > hop * 12) {
        nextFrameRef.current = buffer.written - FFT_SIZE;
      }

      let processed = 0;
      while (nextFrameRef.current + FFT_SIZE <= buffer.written && processed < 8) {
        if (!buffer.read(nextFrameRef.current, frameRef.current)) break;
        const power = analyser.analyse(frameRef.current);
        display.set(power);
        const hfAcc = hfAccRef.current;
        if (hfAcc) {
          for (let k = 0; k < power.length; k++) hfAcc.acc[k] += power[k];
          hfAcc.frames++;
        }
        nextFrameRef.current += hop;
        processed++;
      }

      const now = performance.now();
      if (now - lastUi > 100) {
        lastUi = now;
        const stats = source.takeStats();
        let sum = 0;
        for (let k = 0; k < display.length; k++) sum += display[k];
        setLevel({
          rms: powerToDb(sum),
          peak: 20 * Math.log10(Math.max(stats.peak, 1e-7)),
          clipped: stats.clipped > 0,
        });
        if (hfAccRef.current) {
          const left = Math.max(0, Math.ceil((hfAccRef.current.until - now) / 1000));
          setHfLeft(left);
          if (now >= hfAccRef.current.until) finishHfCheck();
        }
        const run = stabilityRef.current;
        if (run) {
          if (now >= run.nextAt) {
            run.samples.push(powerToDb(sum));
            run.nextAt += STABILITY_INTERVAL_MS;
          }
          setStabilityLeft(Math.max(0, Math.ceil((run.until - now) / 1000)));
          if (now >= run.until) {
            stabilityRef.current = null;
            setStabilityLeft(0);
            setStability(analyseLevelStability(run.samples, STABILITY_INTERVAL_MS));
          }
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // finishHfCheck is stable for the life of the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, source]);

  const finishHfCheck = () => {
    const acc = hfAccRef.current;
    const analyser = analyserRef.current;
    hfAccRef.current = null;
    setHfLeft(0);
    if (!acc || !analyser || acc.frames === 0) return;
    const avg = new Float64Array(acc.acc.length);
    for (let k = 0; k < avg.length; k++) avg[k] = acc.acc[k] / acc.frames;
    const mapping = mapBinsToBands(bands, analyser.binWidth, analyser.bins);
    const levels = Array.from(bandEnergy(avg, mapping), powerToDb);
    const noise = noiseRef.current
      ? Array.from(bandEnergy(noiseRef.current, mapping), powerToDb)
      : levels.map(() => -140);
    setHf(analyseHighEnd(bands, levels, noise));
  };

  const startHfCheck = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    setHf(null);
    hfAccRef.current = {
      acc: new Float64Array(analyser.bins),
      frames: 0,
      until: performance.now() + HF_CHECK_SECONDS * 1000,
    };
    setHfLeft(HF_CHECK_SECONDS);
  };

  const startStabilityCheck = () => {
    setStability(null);
    const now = performance.now();
    stabilityRef.current = {
      samples: [],
      nextAt: now,
      until: now + STABILITY_SECONDS * 1000,
    };
    setStabilityLeft(STABILITY_SECONDS);
  };

  const startRecording = () => {
    const analyser = analyserRef.current;
    const buffer = source.buffer;
    if (!analyser || !buffer) return;
    if (wavUrl) {
      URL.revokeObjectURL(wavUrl);
      setWavUrl(null);
    }
    const startAt = buffer.written;
    const total = Math.floor(RECORD_SECONDS * analyser.sampleRate);
    setRecordLeft(RECORD_SECONDS);
    const timer = window.setInterval(() => {
      const b = source.buffer;
      if (!b) {
        window.clearInterval(timer);
        return;
      }
      const left = Math.max(0, Math.ceil((total - (b.written - startAt)) / analyser.sampleRate));
      setRecordLeft(left);
      if (b.written - startAt >= total) {
        window.clearInterval(timer);
        const out = new Float32Array(total);
        // The ring buffer holds 12 s, so a 10 s take is always still intact.
        if (b.read(startAt, out)) {
          setWavUrl(URL.createObjectURL(encodeWav([out], analyser.sampleRate, 16)));
        }
      }
    }, 250);
  };

  const drawSpectrum = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    clearPlot(ctx, w, h);
    const dbMin = -110;
    const dbMax = 0;
    drawGrid(ctx, w, h, { fMin: 20, fMax: 20000, dbMin, dbMax, dbStep: 20 });
    const analyser = analyserRef.current;
    const display = displayRef.current;
    if (!analyser || !display) return;
    ctx.strokeStyle = cssVar('--trace', '#8be04e');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let k = 1; k < display.length; k++) {
      const f = analyser.binFrequency(k);
      if (f < 20 || f > 20000) continue;
      const x = freqToX(f, 20, 20000, w);
      const y = dbToY(powerToDb(display[k] * analyser.enbwBins), dbMin, dbMax, h);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, []);

  const report = useMemo(() => {
    const lines = [
      `EQ Scope — ${t.diagnostics.title}`,
      `${t.diagnostics.userAgent}: ${typeof navigator !== 'undefined' ? navigator.userAgent : '-'}`,
      `${t.diagnostics.secureContext}: ${secure ? 'yes' : 'no'}`,
      `AudioWorklet: ${supported ? 'yes' : 'no'}`,
    ];
    if (info) {
      lines.push(
        `${t.diagnostics.label}: ${info.label}`,
        `${t.diagnostics.sampleRate}: ${info.sampleRate} Hz`,
        `${t.diagnostics.channels}: ${info.channelCount}`,
        `echoCancellation: ${info.applied.echoCancellation}`,
        `noiseSuppression: ${info.applied.noiseSuppression}`,
        `autoGainControl: ${info.applied.autoGainControl}`,
        `settings: ${JSON.stringify(info.settings)}`,
      );
    }
    if (stability) {
      lines.push(
        `Level stability: ${stability.verdict}, drift ${stability.driftDb.toFixed(1)} dB, spread ${stability.spreadDb.toFixed(1)} dB`,
      );
    }
    if (hf) {
      lines.push(
        `HF edge: ${Math.round(hf.edgeHz)} Hz`,
        `HF cliff: ${hf.cliffHz ? `${Math.round(hf.cliffHz)} Hz (-${hf.cliffDropDb.toFixed(1)} dB)` : 'none'}`,
      );
    }
    return lines.join('\n');
  }, [hf, info, secure, stability, supported, t]);

  const processingState: 'ok' | 'bad' | 'unknown' = !info
    ? 'unknown'
    : info.applied.allDisabled === null
      ? 'unknown'
      : info.applied.allDisabled
        ? 'ok'
        : 'bad';

  const verdict =
    processingState === 'bad' || (hf?.cliffHz ?? 0) > 0
      ? { cls: 'bad', text: hf?.cliffHz ? t.diagnostics.verdictBad : t.diagnostics.verdictWarn }
      : processingState === 'unknown'
        ? { cls: 'warn', text: t.diagnostics.verdictWarn }
        : { cls: 'ok', text: t.diagnostics.verdictGood };

  return (
    <div className="screen">
      <div>
        <h1>{t.diagnostics.title}</h1>
        <p className="muted small">{t.diagnostics.intro}</p>
      </div>

      {!secure && <div className="note note--bad">{t.errors.insecure}</div>}
      {!supported && <div className="note note--bad">{t.errors.notSupported}</div>}
      {error && <div className="note note--bad">{error}</div>}

      <div className="card">
        <div className="row">
          <button className="btn--primary" onClick={running ? stop : start} disabled={!supported || !secure}>
            {running ? t.diagnostics.stopCapture : t.diagnostics.startCapture}
          </button>
          <label className="field grow">
            {t.diagnostics.device}
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={running}>
              <option value="">{t.common.none} / default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn--ghost btn--small" onClick={refreshDevices}>
            {t.diagnostics.refreshDevices}
          </button>
        </div>
      </div>

      {info && (
        <div className="card">
          <div className="card__title">{t.diagnostics.processing}</div>
          <div className={`note note--${processingState === 'ok' ? 'ok' : processingState === 'bad' ? 'bad' : 'warn'}`}>
            {processingState === 'ok'
              ? t.diagnostics.processingOk
              : processingState === 'bad'
                ? t.diagnostics.processingBad
                : t.diagnostics.processingUnknown}
          </div>
          <dl className="kv" style={{ marginTop: 10 }}>
            <FlagRow
              label={t.diagnostics.echoCancellation}
              requested={info.requested.echoCancellation}
              applied={info.applied.echoCancellation}
            />
            <FlagRow
              label={t.diagnostics.noiseSuppression}
              requested={info.requested.noiseSuppression}
              applied={info.applied.noiseSuppression}
            />
            <FlagRow
              label={t.diagnostics.autoGainControl}
              requested={info.requested.autoGainControl}
              applied={info.applied.autoGainControl}
            />
            <dt>{t.diagnostics.sampleRate}</dt>
            <dd className="mono">{info.sampleRate} Hz</dd>
            <dt>{t.diagnostics.channels}</dt>
            <dd className="mono">{info.channelCount}</dd>
            <dt>{t.diagnostics.label}</dt>
            <dd>{info.label}</dd>
            <dt>{t.diagnostics.latency}</dt>
            <dd className="mono">
              {info.latencyHint != null ? `${(info.latencyHint * 1000).toFixed(1)} ms` : '—'}
            </dd>
          </dl>
          <details style={{ marginTop: 10 }}>
            <summary className="small muted">{t.diagnostics.rawSettings}</summary>
            <pre>{JSON.stringify(info.settings, null, 2)}</pre>
          </details>
        </div>
      )}

      {running && (
        <>
          <div className="card">
            <div className="card__title">
              <span>{t.diagnostics.level}</span>
              <span className="mono small">
                {level.rms.toFixed(1)} dBFS · {t.diagnostics.peak} {level.peak.toFixed(1)}
                {level.clipped && <span className="badge badge--bad" style={{ marginLeft: 8 }}>{t.diagnostics.clipping}</span>}
              </span>
            </div>
            <div className="meter">
              <div
                className="meter__fill"
                style={{ width: `${Math.max(0, Math.min(100, (level.rms + 80) * 1.25))}%` }}
              />
            </div>
          </div>

          <div className="card">
            <div className="card__title">{t.diagnostics.spectrum}</div>
            <div className="canvas-wrap">
              <Canvas draw={drawSpectrum} animate height={200} ariaLabel={t.diagnostics.spectrum} />
            </div>
          </div>

          <div className="card">
            <div className="card__title">{t.diagnostics.hfCheck}</div>
            <p className="small muted">{t.diagnostics.hfHint}</p>
            <div className="row">
              <button onClick={startHfCheck} disabled={hfLeft > 0}>
                {hfLeft > 0 ? t.diagnostics.hfRunning(hfLeft) : t.diagnostics.hfRun}
              </button>
            </div>
            {hf && (
              <div className="col" style={{ marginTop: 10 }}>
                {!hf.enoughSignal && <div className="note note--warn">{t.diagnostics.hfNeedSignal}</div>}
                <div className="small">{t.diagnostics.hfEdge(hf.edgeHz)}</div>
                {hf.cliffHz ? (
                  <div className="note note--bad">{t.diagnostics.hfCliff(hf.cliffHz, hf.cliffDropDb)}</div>
                ) : (
                  <div className="note note--ok">{t.diagnostics.hfClean}</div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__title">{t.diagnostics.stability}</div>
            <p className="small muted">{t.diagnostics.stabilityHint}</p>
            <div className="row">
              <button onClick={startStabilityCheck} disabled={stabilityLeft > 0}>
                {stabilityLeft > 0
                  ? t.diagnostics.stabilityRunning(stabilityLeft)
                  : t.diagnostics.stabilityRun}
              </button>
            </div>
            {stability && (
              <div style={{ marginTop: 10 }}>
                {stability.verdict === 'stable' && (
                  <div className="note note--ok">{t.diagnostics.stabilityStable(stability.driftDb)}</div>
                )}
                {stability.verdict === 'drifting' && (
                  <div className="note note--bad">
                    {t.diagnostics.stabilityDrifting(stability.driftDb)}
                  </div>
                )}
                {stability.verdict === 'unstable-source' && (
                  <div className="note note--warn">{t.diagnostics.stabilityUnstable}</div>
                )}
                {stability.verdict === 'too-quiet' && (
                  <div className="note note--warn">{t.diagnostics.stabilityTooQuiet}</div>
                )}
                <div className="faint small mono" style={{ marginTop: 6 }}>
                  {stability.segmentsDb.map((v) => v.toFixed(1)).join(' → ')}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__title">{t.diagnostics.record}</div>
            <p className="small muted">{t.diagnostics.recordHint}</p>
            <div className="row">
              <button onClick={startRecording} disabled={recordLeft > 0}>
                {recordLeft > 0 ? t.diagnostics.recording(recordLeft) : t.diagnostics.recordStart}
              </button>
              {wavUrl && (
                <a className="badge badge--ok" href={wavUrl} download="eq-scope-diagnostics.wav">
                  {t.diagnostics.download}
                </a>
              )}
            </div>
          </div>
        </>
      )}

      <PerfMeter />

      <div className="card">
        <div className="card__title">
          <span>{t.diagnostics.verdictTitle}</span>
        </div>
        <div className={`note note--${verdict.cls}`}>{verdict.text}</div>
        <details style={{ marginTop: 10 }}>
          <summary className="small muted">{t.diagnostics.report}</summary>
          <pre>{report}</pre>
          <button
            className="btn--small btn--ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(report).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? t.diagnostics.copied : t.diagnostics.copyReport}
          </button>
        </details>
      </div>
    </div>
  );
}
