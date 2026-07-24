"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { LiquidGlass } from "@/components/liquid-glass";
import type { SavedWallpaper } from "@/lib/types";

interface Props {
  items: SavedWallpaper[];
  /** 当前正在展示的收藏 id（高亮用） */
  currentId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

/** 壁纸收藏画廊：液态玻璃弹层，网格展示缩略图，点击设为当前，悬停可删除 */
export function WallpaperGallery({ items, currentId, onClose, onSelect, onRemove }: Props) {
  const { t } = useI18n();

  return (
    <LiquidGlass
      as="div"
      mode="rect"
      corner={24}
      scale={30}
      blur={12}
      className="fixed bottom-12 right-3 z-40 w-80 origin-bottom-right animate-[fade-up_0.18s_ease-out] overflow-hidden rounded-3xl border border-white/15 text-white"
    >
      <div className="relative z-[3] flex max-h-[70vh] flex-col p-3">
        <div className="flex items-center gap-2 px-1 pb-2">
          <p className="flex-1 text-[13px] font-medium">{t("wallpaper.galleryTitle")}</p>
          {items.length > 0 && (
            <span className="text-[11px] text-white/55">
              {t("wallpaper.collectionCount", { n: items.length })}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("a11y.closeGallery")}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-white/55">
            {t("wallpaper.emptyCollection")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 overflow-y-auto pr-0.5">
            {items.map((w) => {
              const isCurrent = w.id === currentId;
              return (
                <div key={w.id} className="group/thumb relative aspect-video">
                  <button
                    type="button"
                    onClick={() => onSelect(w.id)}
                    aria-label={w.title || w.copyright || t("wallpaper.galleryTitle")}
                    className={cn(
                      "absolute inset-0 overflow-hidden rounded-xl border bg-black/20 transition-all",
                      isCurrent
                        ? "border-white ring-2 ring-white/80"
                        : "border-white/15 hover:border-white/50"
                    )}
                  >
                    {w.thumb ? (
                      <img
                        src={w.thumb}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-white/60">
                        {w.title || "—"}
                      </span>
                    )}
                  </button>

                  {isCurrent && (
                    <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {t("wallpaper.galleryCurrent")}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemove(w.id)}
                    aria-label={t("a11y.unlikeWallpaper")}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white/90 opacity-0 transition-opacity hover:bg-black/75 group-hover/thumb:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </LiquidGlass>
  );
}
