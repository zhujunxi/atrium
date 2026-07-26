"use client";

import * as React from "react";
import { Download, Laptop, Moon, Plus, RefreshCw, Settings, Sparkles, Sun, Upload } from "lucide-react";
// RefreshCw 复用为「同步模式」图标
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LiquidGlass } from "@/components/liquid-glass";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { WallpaperSection } from "@/components/wallpaper-section";
import { exportNav, importNav, readEntrance, writeEntrance } from "@/lib/store";
import { disableHiRes, enableHiRes, isHiResEnabled } from "@/lib/favicon";
import { useI18n } from "@/lib/i18n";
import type { NavData } from "@/lib/types";

const APPEARANCE = [
  { key: "light", labelKey: "appearance.light", icon: Sun },
  { key: "dark", labelKey: "appearance.dark", icon: Moon },
  { key: "system", labelKey: "appearance.system", icon: Laptop },
] as const;

/** 右上角「新建 + 设置」液态玻璃胶囊按钮组（macOS 风格：同一块玻璃内含两个控件，弹出层在玻璃外渲染避免被裁切） */
export function SettingsMenu({
  onImported,
  onAdd,
  syncMode,
  onToggleSyncMode,
}: {
  onImported: (data: NavData) => void;
  onAdd: (origin: { x: number; y: number }) => void;
  /** 同步模式：网格即 Chrome 收藏夹（实时双向） */
  syncMode: boolean;
  onToggleSyncMode: (on: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [hiRes, setHiRes] = React.useState(true);
  const { t, locale, setLocale } = useI18n();
  // 同步读取「开启动效」开关（当前页已挂载，仅影响下次打开）
  const [entrance, setEntrance] = React.useState(() => readEntrance());

  React.useEffect(() => {
    setHiRes(isHiResEnabled());
  }, []);

  async function toggleHiRes() {
    if (!hiRes) {
      const granted = await enableHiRes();
      if (granted) {
        setHiRes(true);
        toast.success(t("toast.hdOn"));
      } else {
        toast.error(t("toast.hdDenied"));
      }
    } else {
      await disableHiRes();
      setHiRes(false);
      toast.success(t("toast.hdOff"));
    }
  }

  async function handleExport() {
    try {
      const json = await exportNav();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      toast.error(t("toast.exportFail"));
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = await importNav(text);
      onImported(data);
      toast.success(t("toast.importOk"));
      setOpen(false);
    } catch {
      toast.error(t("toast.importFail"));
    }
  }

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = (theme ?? resolvedTheme ?? "system") as string;

  const btn =
    "group relative flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-transform duration-200 hover:scale-105 hover:text-white active:scale-95";

  return (
    <div ref={ref} className="fixed right-4 top-4 z-40">
      {/* 胶囊：一块液态玻璃同时承载「新建」与「设置」；入场淡入挂在玻璃自身（非祖先），
          否则祖先 opacity 动画会隔离背景、导致毛玻璃模糊在动画期间消失 */}
      <LiquidGlass
        as="div"
        mode="rect"
        corner={18}
        scale={18}
        blur={1.5}
        className={cn(
          "flex items-center gap-1 rounded-full px-1 py-0.5 transition-transform duration-200 hover:-translate-y-0.5 hover:drop-shadow-[0_10px_20px_rgba(0,0,0,0.35)]",
          entrance && "lp-fade-in"
        )}
        style={entrance ? { animationDelay: "200ms" } : undefined}
      >
          <button
            type="button"
            aria-label={t("a11y.add")}
            onClick={(e) => onAdd({ x: e.clientX, y: e.clientY })}
            className={btn}
          >
            <Plus className="relative z-[3] h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-125" />
          </button>
          <button
            type="button"
            aria-label={t("a11y.settings")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={btn}
          >
          <Settings className="relative z-[3] h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-45" />
        </button>
      </LiquidGlass>

      {open && (
        <LiquidGlass
          as="div"
          mode="rect"
          corner={24}
          scale={30}
          blur={12}
          className="absolute right-0 top-12 z-50 w-64 origin-top-right animate-[fade-up_0.18s_ease-out] rounded-3xl p-3 text-white"
        >
          <div className="relative z-[3]">
            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55">
              {t("settings.appearance")}
            </p>
            <SegmentedControl
              ariaLabel={t("settings.appearance")}
              value={active}
              onChange={(k) => setTheme(k)}
              options={
                APPEARANCE.map((o) => ({
                  key: o.key,
                  label: t(o.labelKey),
                  icon: o.icon,
                })) as SegmentedOption<string>[]
              }
            />

            <WallpaperSection />

            <div className="my-2 h-px bg-white/15" />

            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55">
              {t("settings.language")}
            </p>
            <SegmentedControl
              ariaLabel={t("settings.language")}
              value={locale}
              onChange={setLocale}
              options={[
                { key: "zh-CN", label: t("language.chinese") },
                { key: "en", label: t("language.english") },
              ]}
            />

            <div className="my-2 h-px bg-white/15" />

            <button
              type="button"
              onClick={toggleHiRes}
              className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Sparkles className="h-4 w-4" />
              <span className="flex-1 text-left">{t("settings.hdIcons")}</span>
              <span
              className={
                "relative h-5 w-9 rounded-full transition-colors " +
                (hiRes ? "bg-[#0A84FF]" : "bg-white/20")
              }
              >
              <span
                className={
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " +
                  (hiRes ? "left-[18px]" : "left-0.5")
                }
              />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !entrance;
                setEntrance(next);
                writeEntrance(next);
              }}
              className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Sparkles className="h-4 w-4" />
              <span className="flex-1 text-left">{t("settings.entrance")}</span>
              <span
                className={
                  "relative h-5 w-9 rounded-full transition-colors " +
                  (entrance ? "bg-[#0A84FF]" : "bg-white/20")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " +
                    (entrance ? "left-[18px]" : "left-0.5")
                  }
                />
              </span>
            </button>
            <p className="px-3 pb-1 pt-0.5 text-[11px] leading-snug text-white/45">
              {t("settings.entranceDesc")}
            </p>

            <div className="my-2 h-px bg-white/15" />

            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55">
              {t("settings.bookmarks")}
            </p>
            <button
              type="button"
              onClick={() => onToggleSyncMode(!syncMode)}
              className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="flex-1 text-left">{t("settings.syncMode")}</span>
              <span
                className={
                  "relative h-5 w-9 rounded-full transition-colors " +
                  (syncMode ? "bg-[#0A84FF]" : "bg-white/20")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " +
                    (syncMode ? "left-[18px]" : "left-0.5")
                  }
                />
              </span>
            </button>
            <p className="px-3 pb-1 pt-0.5 text-[11px] leading-snug text-white/45">
              {syncMode ? t("settings.syncModeOnDesc") : t("settings.syncModeOffDesc")}
            </p>

            <div className="my-2 h-px bg-white/15" />

            {syncMode ? (
              <p className="px-3 py-2 text-[11px] leading-snug text-white/45">
                {t("settings.importExportSyncHint")}
              </p>
            ) : (
              <>
                <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55">
                  {t("settings.data")}
                </p>
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <Download className="h-4 w-4" />
                  {t("settings.export")}
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <Upload className="h-4 w-4" />
                  {t("settings.import")}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </>
            )}
          </div>
        </LiquidGlass>
      )}
    </div>
  );
}
