import { useState } from 'react';
import { useEngine, useEngineTick } from '../useEngine';
import { useT } from '../../i18n';
import { Segmented, Toggle } from '../components/Controls';
import { TransferPlot } from '../components/TransferPlot';
import type { DelayEstimate } from '../../dsp/transfer';

/** Speed of sound at room temperature, for turning delay into distance. */
const SPEED_OF_SOUND = 343;

export function TransferScreen() {
  const t = useT();
  const { engine, running, start, stop, settings, update } = useEngine();
  useEngineTick(250);

  const [smoothing, setSmoothing] = useState(6);
  const [delay, setDelay] = useState<DelayEstimate | null>(null);

  const s = engine.snapshot;
  const delayMs = s.transferDelayMs;

  return (
    <div className="screen">
      <h1>{t.transfer.title}</h1>
      <p className="small muted">{t.transfer.intro}</p>
      <div className="note">{t.transfer.requirements}</div>

      <div className="card col">
        <div className="row row--between">
          <span className="small muted">{t.transfer.enable}</span>
          <Toggle
            checked={settings.dualChannel}
            onChange={(dualChannel) => update({ dualChannel })}
            label={settings.dualChannel ? t.common.on : t.common.off}
          />
        </div>
        <div className="faint small">{t.transfer.restartNote}</div>
        {settings.dualChannel && (
          <div className={`note note--${s.dualChannelActive ? 'ok' : 'warn'} small`}>
            {s.dualChannelActive ? t.transfer.active : t.transfer.inactive}
          </div>
        )}
        <div className="row row--between">
          <span className="small muted">{t.transfer.referenceIs(settings.referenceChannel)}</span>
          <button
            className="btn--small btn--ghost"
            onClick={() => update({ referenceChannel: settings.referenceChannel === 0 ? 1 : 0 })}
          >
            {t.transfer.swap}
          </button>
        </div>
        <div className="row">
          <button className="btn--primary" onClick={running ? stop : start}>
            {running ? t.common.stop : t.common.start}
          </button>
          <button
            disabled={!s.dualChannelActive}
            onClick={() => setDelay(engine.findDelay())}
          >
            {t.transfer.findDelay}
          </button>
          <button
            className="btn--ghost btn--small"
            disabled={!s.dualChannelActive}
            onClick={() => engine.resetTransfer()}
          >
            {t.transfer.reset}
          </button>
        </div>
        <div className="row row--between">
          <span className="small muted">{t.transfer.delay}</span>
          <span className="mono small">
            {t.transfer.delayValue(delayMs, (delayMs / 1000) * SPEED_OF_SOUND)}
            {delay && ` · ${t.transfer.delayConfidence(delay.confidence)}`}
          </span>
        </div>
        {delay && delay.confidence < 0.4 && (
          <div className="note note--warn small">{t.transfer.delayLow}</div>
        )}
      </div>

      {!running && <div className="note">{t.transfer.notRunning}</div>}

      <div className="canvas-wrap">
        <TransferPlot engine={engine} smoothingFraction={smoothing} height="46vh" />
      </div>

      <div className="card col">
        <div className="row row--between">
          <span className="small muted">{t.transfer.smoothing}</span>
          <Segmented
            value={smoothing}
            onChange={setSmoothing}
            options={[3, 6, 12, 24].map((f) => ({ value: f, label: `1/${f}` }))}
          />
        </div>
        <div className="row row--between">
          <span className="small muted">{t.transfer.coherence}</span>
          <span className="faint small">{t.transfer.frames(s.transferFrames)}</span>
        </div>
        <div className="faint small">{t.transfer.coherenceHint}</div>
      </div>
    </div>
  );
}
