import * as React from "react";
import type { Dict, Locale, TParams, TranslationKey } from "./types";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const DICTS: Record<Locale, Dict> = { en, "zh-CN": zhCN };

const STORAGE_KEY = "nav:locale";

/** Map any browser/Accept-Language tag to one of our supported locales. */
function normalizeLocale(lang: string | undefined): Locale {
  if (!lang) return "en";
  const l = lang.toLowerCase();
  if (l.startsWith("zh") && (l.includes("cn") || l.includes("hans") || l === "zh")) return "zh-CN";
  if (l.startsWith("zh")) return "zh-CN"; // zh-TW / zh-HK → simplified fallback
  return "en";
}

/** Synchronous best guess before async storage resolves. */
function detectLocaleSync(): Locale {
  const raw =
    typeof chrome !== "undefined" && chrome.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : typeof navigator !== "undefined"
        ? navigator.language
        : "en";
  return normalizeLocale(raw);
}

// Module-level active locale, kept in sync by the provider so `t` works
// even outside React (event handlers, module scope).
let activeLocale: Locale = detectLocaleSync();

function lookup(key: TranslationKey, params?: TParams): string {
  const dict = DICTS[activeLocale] ?? DICTS.en;
  let str: string = dict[key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return str;
}

export function translate(key: TranslationKey, params?: TParams): string {
  return lookup(key, params);
}

// --- React binding -------------------------------------------------------

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, params?: TParams) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

async function loadStoredLocale(): Promise<Locale | null> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const v = res[STORAGE_KEY];
    return v === "en" || v === "zh-CN" ? v : null;
  } catch {
    return null;
  }
}

function saveStoredLocale(l: Locale) {
  try {
    void chrome.storage.local.set({ [STORAGE_KEY]: l });
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(activeLocale);

  // On mount, prefer a previously chosen language stored in settings.
  React.useEffect(() => {
    let alive = true;
    loadStoredLocale().then((stored) => {
      if (stored && alive && stored !== activeLocale) {
        activeLocale = stored;
        setLocaleState(stored);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = React.useCallback((l: Locale) => {
    activeLocale = l;
    setLocaleState(l);
    saveStoredLocale(l);
  }, []);

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: translate }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    // Safe fallback so components work even outside the provider (e.g. tests).
    return { locale: activeLocale, setLocale: () => {}, t: translate };
  }
  return ctx;
}
