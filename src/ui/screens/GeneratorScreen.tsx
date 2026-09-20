import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Segmented } from '../components/Controls';
import { DEFAULT_GENERATOR, SignalPlayer, type GeneratorOptions } from '../../generator/player';
import { SIGNAL_TYPES, type SignalType } from '../../generator/signals';

export function GeneratorScreen() {
  const t = useT();
  const playerRef = useRef<SignalPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new SignalPlayer();
  const player = playerRef.current;

  const [type, setType] = useState<SignalType>('pink');
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => void player.dispose(), [player]);

  const label: Record<SignalType, string> = {
    pink: t.generator.pink,
    white: t.generator.white,
    sine: t.generator.sine,
    sweep: t.generator.sweep,
  };

  const toggle = async () => {
    if (playing) {
      player.stop();
      setPlaying(false);
      return;
    }
    await player.start(type, options);
    setPlaying(true);
  };

  const change = (patch: Partial<GeneratorOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (patch.levelDb !== undefined) player.setLevel(next.levelDb);
    if (patch.frequencyHz !== undefined) player.setFrequency(next.frequencyHz);
  };

  // Anything that changes the rendered buffer needs the source rebuilt.
  const restartFor = async (patch: Partial<GeneratorOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (playing) await player.start(type, next);
  };

  return (
    <div className="screen">
      <h1>{t.generator.title}</h1>
      <div className="note note--warn">{t.generator.warning}</div>

      <div className="card col">
        <div className="row row--between">
          <span className="small muted">{t.generator.signal}</span>
          <Segmented
            value={type}
            onChange={async (next: SignalType) => {
              setType(next);
              if (playing) await player.start(next, options);
            }}
            options={SIGNAL_TYPES.map((s) => ({ value: s, label: label[s] }))}
          />
        </div>

        <label className="field">
          {t.generator.level}
          <input
            type="range"
            min={-60}
            max={-3}
            step={1}
            value={options.levelDb}
            onChange={(e) => change({ levelDb: Number(e.target.value) })}
          />
          <span className="mono small">{options.levelDb} dBFS</span>
        </label>
        <div className="faint small">{t.generator.levelWarning}</div>

        {type === 'sine' && (
          <label className="field">
            {t.generator.frequency}
            <input
              type="range"
              min={Math.log10(20) * 100}
              max={Math.log10(20000) * 100}
              step={1}
              value={Math.log10(options.frequencyHz) * 100}
              onChange={(e) => change({ frequencyHz: Math.pow(10, Number(e.target.value) / 100) })}
            />
            <span className="mono small">{options.frequencyHz.toFixed(0)} Hz</span>
          </label>
        )}

        {type === 'sweep' && (
          <div className="row">
            <label className="field grow">
              {t.generator.sweepSeconds}
              <input
                type="number"
                min={1}
                max={60}
                value={options.sweepSeconds}
                onChange={(e) => void restartFor({ sweepSeconds: Number(e.target.value) || 10 })}
              />
            </label>
            <label className="field grow">
              {t.generator.sweepRange}
              <div className="row">
                <input
                  type="number"
                  value={options.sweepFromHz}
                  onChange={(e) => void restartFor({ sweepFromHz: Number(e.target.value) || 20 })}
                />
                <input
                  type="number"
                  value={options.sweepToHz}
                  onChange={(e) => void restartFor({ sweepToHz: Number(e.target.value) || 20000 })}
                />
              </div>
            </label>
          </div>
        )}

        <button className={playing ? 'btn--danger' : 'btn--primary'} onClick={toggle}>
          {playing ? t.generator.stop : t.generator.play}
        </button>
      </div>
    </div>
  );
}
