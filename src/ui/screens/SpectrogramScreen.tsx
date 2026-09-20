import { useState } from 'react';
import { useEngine } from '../useEngine';
import { useT } from '../../i18n';
import { Spectrogram } from '../components/Spectrogram';
import { Segmented } from '../components/Controls';

export function SpectrogramScreen() {
  const t = useT();
  const { engine, running, start, stop, frozen, setFrozen } = useEngine();
  const [range, setRange] = useState(60);

  return (
    <div className="screen">
      <div className="card">
        <div className="row row--between">
          <div className="row">
            <button className="btn--primary" onClick={running ? stop : start}>
              {running ? t.common.stop : t.common.start}
            </button>
            <button onClick={() => setFrozen(!frozen)} disabled={!running}>
              {frozen ? t.common.unfreeze : t.common.freeze}
            </button>
          </div>
          <Segmented
            value={range}
            onChange={setRange}
            ariaLabel={t.spectrogram.range}
            options={[40, 60, 80].map((v) => ({ value: v, label: `${v} ${t.common.db}` }))}
          />
        </div>
      </div>

      <div className="canvas-wrap">
        <Spectrogram engine={engine} dynamicRangeDb={range} height="52vh" />
      </div>

      <div className="faint small">{t.spectrogram.hint}</div>
    </div>
  );
}
