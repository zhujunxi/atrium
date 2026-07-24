"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavFolder, NavLink } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LiquidGlass } from "@/components/liquid-glass";
import { useI18n } from "@/lib/i18n";

export interface LinkDialogState {
  open: boolean;
  /** 默认放入的文件夹，null 表示桌面 */
  folderId: string | null;
  initial?: NavLink | null;
  /** 触发点的屏幕坐标：弹窗从该位置缩放展开到居中（同文件夹展开逻辑） */
  origin?: { x: number; y: number } | null;
}

export interface LinkFormValues {
  title: string;
  url: string;
  description: string;
  /** null = 桌面根级 */
  folderId: string | null;
}

interface LinkDialogProps {
  state: LinkDialogState;
  folders: NavFolder[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: LinkFormValues) => void;
}

function normalizeUrl(raw: string) {
  const u = raw.trim();
  if (!u) return u;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

type Phase = "enter" | "open" | "exit";

/** 复用文件夹展开层逻辑：从触发点缩放展开到居中，收起时缩回触发点；用 CSS 变量携带初始态，避免闪烁 */
export function LinkDialog({ state, folders, onOpenChange, onSubmit }: LinkDialogProps) {
  const { open, initial, origin } = state;
  const { t } = useI18n();
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [folderId, setFolderId] = React.useState("");
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = React.useState<Phase>("enter");
  const closingRef = React.useRef(false);

  // 打开时重置表单 + 复位关闭守卫/相位。
  // 注意：关闭后组件以 `return null` 卸载渲染但实例仍被 React 保留（hook 不销毁），
  // 因此 closingRef 会残留 true，导致「再次打开后无法关闭」。必须在每次 open 时复位。
  React.useEffect(() => {
    if (open) {
      closingRef.current = false;
      setPhase("enter");
      setTitle(initial?.title ?? "");
      setUrl(initial?.url ?? "");
      setDescription(initial?.description ?? "");
      setFolderId(state.folderId ?? "");
    }
  }, [open, initial, state.folderId]);

  // 挂载即把「缩到触发点处的初始态」写进 CSS 变量，再用双 rAF 切到展开态触发过渡
  React.useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const prevTransform = wrap.style.transform;
    wrap.style.transition = "none";
    wrap.style.transform = "none";
    const wr = wrap.getBoundingClientRect();
    // 用触发点构造一个近似的源矩形（控制本身约 40px），从而从点击处缩放展开
    const srcSize = 40;
    const ir = origin
      ? { left: origin.x - srcSize / 2, top: origin.y - srcSize / 2, width: srcSize, height: srcSize }
      : null;
    let scale = 0.12;
    let ox = wr.width / 2;
    let oy = wr.height / 2;
    if (ir) {
      scale = ir.width / wr.width;
      ox = ir.left + ir.width / 2 - wr.left;
      oy = ir.top + ir.height / 2 - wr.top;
    }
    wrap.style.transition = "";
    wrap.style.transform = prevTransform;
    wrap.style.setProperty("--fz-s", String(scale));
    wrap.style.setProperty("--fz-ox", `${ox}px`);
    wrap.style.setProperty("--fz-oy", `${oy}px`);

    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
    return () => cancelAnimationFrame(raf);
  }, [open, origin]);

  const requestClose = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase("exit");
    // 兜底：万一 transitionend 没触发，也确保卸载
    window.setTimeout(() => onOpenChange(false), 300 + 120);
  }, [onOpenChange]);

  // 收起动画播完后（transform 过渡结束）才通知父组件卸载
  const handleTransitionEnd = React.useCallback(
    (e: React.TransitionEvent) => {
      if (e.target === wrapRef.current && e.propertyName === "transform" && phase === "exit") {
        onOpenChange(false);
      }
    },
    [phase, onOpenChange]
  );

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const u = normalizeUrl(url);
    if (!t || !u) return;
    onSubmit({ title: t, url: u, description: description.trim(), folderId: folderId || null });
    onOpenChange(false);
  }

  const fieldCls =
    "flex h-9 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-1 text-sm text-white shadow-sm transition-colors placeholder:text-white/45 focus-visible:outline-none focus-visible:border-white/30 focus-visible:bg-white/15";
  const labelCls = "text-[11px] font-medium uppercase tracking-wide text-white/55";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* 蒙版：与文件夹展开层一致——透明 + backdrop-blur，不压暗背景 */}
      <div
        className={cn(
          "lp-dialog-backdrop absolute inset-0 bg-black/40 backdrop-blur-xl",
          phase === "open" && "is-open",
          phase === "exit" && "is-exit"
        )}
        onClick={requestClose}
      />
      <div
        ref={wrapRef}
        onTransitionEnd={handleTransitionEnd}
        className={cn(
          "lp-dialog-panel relative z-[61] w-[340px]",
          phase === "open" && "is-open",
          phase === "exit" && "is-exit"
        )}
      >
        <LiquidGlass
          as="div"
          mode="rect"
          corner={32}
          scale={30}
          blur={12}
          className="liquid-glass-folder relative rounded-[2rem] p-6 text-white shadow-2xl shadow-black/30"
        >
          <div className="relative z-[3]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                {t(initial ? "dialog.editTitle" : "dialog.addTitle")}
              </h2>
              <button
                type="button"
                aria-label={t("a11y.close")}
                onClick={requestClose}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="link-title" className={labelCls}>
                  {t("dialog.title")}
                </Label>
                <Input
                  id="link-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("dialog.titlePh")}
                  autoFocus
                  maxLength={30}
                  className={fieldCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-url" className={labelCls}>
                  {t("dialog.url")}
                </Label>
                <Input
                  id="link-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("dialog.urlPh")}
                  inputMode="url"
                  className={fieldCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-desc" className={labelCls}>
                  {t("dialog.description")}
                </Label>
                <Input
                  id="link-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("dialog.descPh")}
                  maxLength={50}
                  className={fieldCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-folder" className={labelCls}>
                  {t("dialog.location")}
                </Label>
                <select
                  id="link-folder"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className={fieldCls}
                >
                  <option value="">{t("dialog.desktop")}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={requestClose}
                  className="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
                >
                  {t("dialog.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !url.trim()}
                  className="rounded-lg bg-[#0A84FF] px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0A84FF]/90 disabled:opacity-40"
                >
                  {t("dialog.save")}
                </button>
              </div>
            </form>
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}
