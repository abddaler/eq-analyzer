import { useState } from 'react';
import { useT } from '../../i18n';

const SEEN_KEY = 'eqscope.onboarded';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode: it will simply be shown again next time.
  }
}

/**
 * Four screens on first run. Three are the practical ones from the brief -
 * where to put the phone, what not to trust, why a measurement microphone -
 * and the fourth states what the app is and is not, because that framing is
 * the product.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);

  const steps = [
    { icon: '📱', title: t.onboarding.placeTitle, body: t.onboarding.placeBody, tip: t.onboarding.placeTip },
    { icon: '🚫', title: t.onboarding.trustTitle, body: t.onboarding.trustBody, tip: t.onboarding.trustTip },
    { icon: '🎙️', title: t.onboarding.micTitle, body: t.onboarding.micBody, tip: t.onboarding.micTip },
    { icon: '👂', title: t.onboarding.honestTitle, body: t.onboarding.honestBody, tip: '' },
  ];

  const finish = () => {
    markSeen();
    onDone();
  };

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <div className="row row--between">
          <span className="faint small">{t.onboarding.step(step + 1, steps.length)}</span>
          <button className="btn--ghost btn--small" onClick={finish}>
            {t.onboarding.skip}
          </button>
        </div>
        <div className="onboarding__icon">{current.icon}</div>
        <h2>{current.title}</h2>
        <p className="muted">{current.body}</p>
        {current.tip && <div className="note">{current.tip}</div>}
        <div className="onboarding__dots">
          {steps.map((s, i) => (
            <span key={s.title} className={`onboarding__dot${i === step ? ' onboarding__dot--on' : ''}`} />
          ))}
        </div>
        <div className="row">
          {step > 0 && (
            <button className="btn--ghost grow" onClick={() => setStep(step - 1)}>
              {t.common.back}
            </button>
          )}
          <button className="btn--primary grow" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? t.onboarding.start : t.common.next}
          </button>
        </div>
      </div>
    </div>
  );
}
