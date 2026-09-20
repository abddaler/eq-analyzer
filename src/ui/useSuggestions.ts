import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngine } from './useEngine';
import { alignTargetToBands, findTarget, type TargetCurve } from '../analysis/targets';
import { bandTrust } from '../analysis/confidence';
import { generateSuggestions, SuggestionStabilizer, type Suggestion } from '../analysis/suggest';

const RECOMPUTE_MS = 500;

export interface SuggestionsState {
  suggestions: Suggestion[];
  /** Target projected onto the current bands, level-matched. */
  targetDb: Float64Array | null;
  /** How full the long averaging window is, 0..1. */
  windowFill: number;
  ready: boolean;
}

/**
 * Recomputes suggestions on a slow timer and passes them through the
 * stabiliser, so the cards change at reading speed rather than frame rate.
 */
export function useSuggestions(targetId: string, extraTargets: TargetCurve[] = []): SuggestionsState {
  const { engine, running, settings } = useEngine();
  const [state, setState] = useState<SuggestionsState>({
    suggestions: [],
    targetDb: null,
    windowFill: 0,
    ready: false,
  });
  const stabilizerRef = useRef(new SuggestionStabilizer());
  const curve = useMemo(() => findTarget(targetId, extraTargets), [extraTargets, targetId]);

  useEffect(() => {
    stabilizerRef.current.reset();
  }, [targetId, settings.fraction, settings.micProfile]);

  useEffect(() => {
    if (!running || !curve) {
      setState({ suggestions: [], targetDb: null, windowFill: 0, ready: false });
      return;
    }
    const timer = window.setInterval(() => {
      const s = engine.snapshot;
      if (s.bands.length === 0) return;
      // Suggestions are made from the long window; the fast trace is for the
      // eye, not for decisions.
      const levels = s.longFill > 0 ? s.longBandDb : s.bandDb;
      const targetDb = alignTargetToBands(curve, s.bands, levels);
      const micFrom = settings.micProfile?.trustedFromHz ?? 20;
      const micTo = settings.micProfile?.trustedToHz ?? 20000;
      const trust = bandTrust(s.bands, levels, s.noiseFloorDb, micFrom, micTo);
      const fresh = generateSuggestions({
        bands: s.bands,
        levelsDb: levels,
        targetDb,
        trust,
        seconds: Math.min(s.elapsedSeconds, s.longSeconds * s.longFill || s.elapsedSeconds),
        windowFill: s.longFill,
      });
      const stable = stabilizerRef.current.update(fresh, performance.now());
      setState({
        suggestions: stable,
        targetDb,
        windowFill: s.longFill,
        // Below a third of the window the average still swings too much to
        // say anything useful about a mix.
        ready: s.longFill >= 0.33,
      });
    }, RECOMPUTE_MS);
    return () => window.clearInterval(timer);
  }, [curve, engine, running, settings.micProfile, settings.fraction]);

  return state;
}
