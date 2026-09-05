import * as React from "react";
import type { Dict, Locale, LocaleSetting, TParams, TranslationKey } from "./types";
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
//
// 生效语言的同步镜像（localStorage）：chrome.storage 只有异步 API，若初始
// locale 走「异步读设置」，挂载瞬间会先用「系统检测语言」渲染并触发壁纸对齐，
// 设置加载完成后又切回来——两条对齐路径并发提交，谁后完成谁上屏。
// 镜像让首帧渲染就拿到的就是上一次的生效语言，从根上消掉这个窗口。
const MIRROR_KEY = "nav:locale-ls";

function readMirroredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(MIRROR_KEY);
    return v === "en" || v === "zh-CN" ? v : null;
  } catch {
    return null;
  }
}

function mirrorLocale(l: Locale) {
  try {
    localStorage.setItem(MIRROR_KEY, l);
  } catch {
    /* ignore */
  }
}

let activeLocale: Locale = readMirroredLocale() ?? detectLocaleSync();

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
  /** 语言设置项本身：system = 跟随系统语言（未单独设置时的默认值） */
  localeSetting: LocaleSetting;
  setLocale: (l: LocaleSetting) => void;
  t: (key: TranslationKey, params?: TParams) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

async function loadStoredLocale(): Promise<LocaleSetting | null> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const v = res[STORAGE_KEY];
    return v === "en" || v === "zh-CN" || v === "system" ? v : null;
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

function removeStoredLocale() {
  try {
    void chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // 首帧就用同步镜像的生效语言（没有才退回系统检测），避免「先用检测语言
  // 渲染并对齐壁纸、设置异步加载后再切回来」的双路径竞态
  const [locale, setLocaleState] = React.useState<Locale>(
    () => readMirroredLocale() ?? activeLocale
  );
  /** 设置项本身的值：system = 跟随系统（默认，不落盘） */
  const [setting, setSettingState] = React.useState<LocaleSetting>("system");

  // On mount, prefer a previously chosen language stored in settings.
  // 未设置或设置为「跟随系统」时保持系统检测结果——
  // 只有用户显式选择中文/English 才落盘固定。
  React.useEffect(() => {
    let alive = true;
    loadStoredLocale().then((stored) => {
      if (!alive || !stored) {
        if (alive) mirrorLocale(activeLocale); // 无显式设置：镜像当前生效值
        return;
      }
      if (stored === "system") {
        setSettingState("system");
        mirrorLocale(activeLocale);
        return;
      }
      setSettingState(stored);
      mirrorLocale(stored);
      if (stored !== activeLocale) {
        activeLocale = stored;
        setLocaleState(stored);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = React.useCallback((l: LocaleSetting) => {
    setSettingState(l);
    if (l === "system") {
      // 跟随系统：清除显式设置，回到系统语言
      removeStoredLocale();
      const detected = detectLocaleSync();
      activeLocale = detected;
      mirrorLocale(detected);
      setLocaleState(detected);
      return;
    }
    activeLocale = l;
    mirrorLocale(l);
    setLocaleState(l);
    saveStoredLocale(l);
  }, []);

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, localeSetting: setting, setLocale, t: translate }),
    [locale, setting, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    // Safe fallback so components work even outside the provider (e.g. tests).
    return { locale: activeLocale, localeSetting: "system", setLocale: () => {}, t: translate };
  }
  return ctx;
}
