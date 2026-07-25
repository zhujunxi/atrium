"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  loadWallpaperSettings,
  saveWallpaperSettings,
} from "@/lib/wallpaper-store";
import type { WallpaperMode, WallpaperSettings } from "@/lib/types";

const MODES: { key: WallpaperMode; labelKey: TranslationKey }[] = [
  { key: "bing-daily", labelKey: "settings.wallpaperDaily" },
  { key: "collection", labelKey: "settings.wallpaperCollection" },
  { key: "shuffle-all", labelKey: "settings.wallpaperShuffleAll" },
];

const INTERVALS = [5, 15, 30, 60];

/** 设置面板中的「壁纸」分区：模式三选一 + 自动轮换 + 间隔 */
export function WallpaperSection() {
  const { t } = useI18n();
  const [settings, setSettings] = React.useState<WallpaperSettings | null>(null);

  React.useEffect(() => {
    let alive = true;
    loadWallpaperSettings().then((s) => {
      if (alive) setSettings(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function update(patch: Partial<WallpaperSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveWallpaperSettings(next);
  }

  if (!settings) return null;

  const toggle =
    "relative h-5 w-9 rounded-full transition-colors " +
    (settings.autoRotate ? "bg-[#0A84FF]" : "bg-white/20");
  const knob =
    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " +
    (settings.autoRotate ? "left-[18px]" : "left-0.5");

  return (
    <>
      <div className="my-2 h-px bg-white/15" />

      <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55">
        {t("settings.wallpaper")}
      </p>
      <div className="flex gap-1.5 rounded-2xl bg-black/15 p-1.5">
        {MODES.map((opt) => {
          const isActive = settings.mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => update({ mode: opt.key })}
              className={
                "flex flex-1 items-center justify-center whitespace-nowrap rounded-xl py-1.5 text-[11px] transition-colors " +
                (isActive
                  ? "bg-white/25 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white")
              }
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => update({ autoRotate: !settings.autoRotate })}
        className="mt-1.5 flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
      >
        <span className="flex-1 text-left">{t("settings.autoRotate")}</span>
        <span className={toggle}>
          <span className={knob} />
        </span>
      </button>

      {settings.autoRotate && (
        <div className="flex items-center gap-2 px-3 py-1">
          <span className="text-[11px] text-white/55">{t("settings.rotateInterval")}</span>
          <div className="ml-auto flex gap-1">
            {INTERVALS.map((m) => {
              const isActive = settings.rotateIntervalMin === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => update({ rotateIntervalMin: m })}
                  className={
                    "rounded-lg px-2 py-0.5 text-[11px] transition-colors " +
                    (isActive
                      ? "bg-white/25 text-white"
                      : "bg-white/10 text-white/55 hover:text-white")
                  }
                >
                  {m}m
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
