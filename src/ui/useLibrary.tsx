import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  deleteRecord,
  listRecords,
  newId,
  putRecord,
  STORES,
  type StoredMicProfile,
  type StoredSnapshot,
  type StoredTarget,
} from '../storage/db';
import type { TargetCurve } from '../analysis/targets';
import type { MicProfile } from '../dsp/calibration';
import { interpolateResponse } from '../dsp/calibration';
import type { Band } from '../dsp/octave';

interface LibraryValue {
  snapshots: StoredSnapshot[];
  targets: StoredTarget[];
  micProfiles: StoredMicProfile[];
  /** Stored targets in the shape the analysis layer expects. */
  customTargets: TargetCurve[];
  customMicProfiles: MicProfile[];
  available: boolean;
  saveSnapshot: (snapshot: Omit<StoredSnapshot, 'id' | 'createdAt'>) => Promise<StoredSnapshot | null>;
  removeSnapshot: (id: string) => Promise<void>;
  saveTarget: (name: string, points: { f: number; db: number }[]) => Promise<StoredTarget | null>;
  removeTarget: (id: string) => Promise<void>;
  saveMicProfile: (profile: Omit<StoredMicProfile, 'id' | 'createdAt'>) => Promise<StoredMicProfile | null>;
  removeMicProfile: (id: string) => Promise<void>;
}

const LibraryContext = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [targets, setTargets] = useState<StoredTarget[]>([]);
  const [micProfiles, setMicProfiles] = useState<StoredMicProfile[]>([]);
  const [available, setAvailable] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [s, t, m] = await Promise.all([
        listRecords<StoredSnapshot>(STORES.snapshots),
        listRecords<StoredTarget>(STORES.targets),
        listRecords<StoredMicProfile>(STORES.micProfiles),
      ]);
      setSnapshots(s.sort((a, b) => b.createdAt - a.createdAt));
      setTargets(t.sort((a, b) => b.createdAt - a.createdAt));
      setMicProfiles(m.sort((a, b) => b.createdAt - a.createdAt));
      setAvailable(true);
    } catch {
      // Private browsing and locked-down WebViews have no IndexedDB; the app
      // still measures, it just cannot remember anything.
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveSnapshot = useCallback<LibraryValue['saveSnapshot']>(
    async (snapshot) => {
      const record: StoredSnapshot = { ...snapshot, id: newId('snap'), createdAt: Date.now() };
      try {
        await putRecord(STORES.snapshots, record);
        await reload();
        return record;
      } catch {
        setAvailable(false);
        return null;
      }
    },
    [reload],
  );

  const saveTarget = useCallback<LibraryValue['saveTarget']>(
    async (name, points) => {
      const record: StoredTarget = { id: newId('target'), name, createdAt: Date.now(), points };
      try {
        await putRecord(STORES.targets, record);
        await reload();
        return record;
      } catch {
        setAvailable(false);
        return null;
      }
    },
    [reload],
  );

  const saveMicProfile = useCallback<LibraryValue['saveMicProfile']>(
    async (profile) => {
      const record: StoredMicProfile = { ...profile, id: newId('mic'), createdAt: Date.now() };
      try {
        await putRecord(STORES.micProfiles, record);
        await reload();
        return record;
      } catch {
        setAvailable(false);
        return null;
      }
    },
    [reload],
  );

  const remove = useCallback(
    (store: typeof STORES.snapshots | typeof STORES.targets | typeof STORES.micProfiles) =>
      async (id: string) => {
        try {
          await deleteRecord(store, id);
          await reload();
        } catch {
          setAvailable(false);
        }
      },
    [reload],
  );

  const value = useMemo<LibraryValue>(() => {
    const customTargets: TargetCurve[] = targets.map((t) => ({
      id: t.id,
      customName: t.name,
      points: t.points,
      builtin: false,
    }));
    const customMicProfiles: MicProfile[] = micProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      trustedFromHz: p.trustedFromHz,
      trustedToHz: p.trustedToHz,
      approximate: false,
      sensitivityDb: p.sensitivityDb,
      source: p.source,
    }));
    return {
      snapshots,
      targets,
      micProfiles,
      customTargets,
      customMicProfiles,
      available,
      saveSnapshot,
      removeSnapshot: remove(STORES.snapshots),
      saveTarget,
      removeTarget: remove(STORES.targets),
      saveMicProfile,
      removeMicProfile: remove(STORES.micProfiles),
    };
  }, [available, micProfiles, remove, saveMicProfile, saveSnapshot, saveTarget, snapshots, targets]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}

/**
 * Project a stored snapshot onto the current band set.
 * Snapshots keep their own band centres so they stay comparable after the
 * smoothing setting changes.
 */
export function snapshotOnBands(snapshot: StoredSnapshot, bands: Band[], useLong = true): Float64Array {
  const source = useLong && snapshot.longBandDb.length ? snapshot.longBandDb : snapshot.bandDb;
  const points = snapshot.bandCenters.map((f, i) => ({ f, db: source[i] }));
  return interpolateResponse(points, bands.map((b) => b.center));
}
