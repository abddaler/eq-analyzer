import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ru, type Dict } from './ru';
import { en } from './en';

export type Locale = 'ru' | 'en';

/** Adding a locale means adding one entry here plus a file shaped like Dict. */
export const LOCALES: Record<Locale, { name: string; dict: Dict }> = {
  ru: { name: 'Русский', dict: ru },
  en: { name: 'English', dict: en },
};

const STORAGE_KEY = 'eqscope.locale';

function detectLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  }
  if (typeof navigator !== 'undefined' && navigator.language.startsWith('en')) return 'en';
  return 'ru';
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dict;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the choice simply does not persist.
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: LOCALES[locale].dict }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Shorthand for the common case of only needing the strings. */
export function useT(): Dict {
  return useI18n().t;
}
