import type { MicProfile } from '../dsp/calibration';

/**
 * Generic phone microphone.
 *
 * MEMS capsules are reasonably flat from about 100 Hz to 10 kHz, roll off hard
 * below 50-60 Hz and get bumpy above 10 kHz. These numbers are a plausible
 * average for the class, not a measurement of any particular phone - the
 * profile is flagged approximate and the UI says so. Below 80 Hz nothing here
 * should be trusted without an external microphone.
 */
export const PHONE_GENERIC: MicProfile = {
  id: 'phone-generic',
  name: 'Микрофон телефона (общий)',
  approximate: true,
  trustedFromHz: 80,
  trustedToHz: 16000,
  source: 'builtin',
  points: [
    { f: 20, db: -30 },
    { f: 25, db: -25 },
    { f: 31.5, db: -20 },
    { f: 40, db: -14 },
    { f: 50, db: -9 },
    { f: 63, db: -5 },
    { f: 80, db: -2.5 },
    { f: 100, db: -1 },
    { f: 125, db: -0.3 },
    { f: 250, db: 0 },
    { f: 1000, db: 0 },
    { f: 4000, db: 0.5 },
    { f: 6300, db: 1 },
    { f: 8000, db: 1.5 },
    { f: 10000, db: 1 },
    { f: 12500, db: 2 },
    { f: 16000, db: 0 },
    { f: 20000, db: -4 },
  ],
};

/** No correction at all - for a measurement microphone with its own file. */
export const FLAT: MicProfile = {
  id: 'flat',
  name: 'Без коррекции (ровный)',
  approximate: false,
  trustedFromHz: 20,
  trustedToHz: 20000,
  source: 'builtin',
  points: [
    { f: 20, db: 0 },
    { f: 20000, db: 0 },
  ],
};

export const BUILTIN_PROFILES: MicProfile[] = [PHONE_GENERIC, FLAT];
