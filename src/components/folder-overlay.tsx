"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavFolder, NavItem } from "@/lib/types";
import { LpItem } from "@/components/lp-item";
import { LiquidGlass } from "@/components/liquid-glass";

interface FolderOverlayProps {
  folder: NavFolder;
  edit: boolean;
  dragId: string | null;
  /** 面板 DOM 引用：拖拽落点判定（落在面板外 = 移出文件夹） */
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 打开该文件夹的图标屏幕坐标：用于 macOS 式从图标缩放展开/收起 */
  originRect: DOMRect | null;
  onPointerDownItem: (e: React.PointerEvent, item: NavItem) => void;
  onDeleteItem: (item: NavItem) => void;
  onRename: (name: string) => void;
  onAddLink: (origin?: { x: number; y: number }) => void;
  /** 收起动画结束后由父组件卸载 */
  onClose: () => void;
}

/** 动画时长，需与 globals.css 中 .folder-zoom / .folder-backdrop 的 transition 对齐 */
const DURATION = 300;

type Phase = "enter" | "open" | "exit";

/** macOS Launchpad 风格文件夹展开层：从图标缩放展开，收起时缩回图标 */
export function FolderOverlay({
  folder,
  edit,
  dragId,
  panelRef,
  originRect,
  onPointerDownItem,
  onDeleteItem,
  onRename,
  onAddLink,
  onClose,
}: FolderOverlayProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = React.useState<Phase>("enter");
  const closingRef = React.useRef(false);

  // 挂载即把「缩到图标处的初始态」写进 CSS 变量，再用双 rAF 切到展开态触发过渡
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // 关键：先去掉缩放量出面板「完整」尺寸/位置，否则会把被缩放后的小框当尺寸，
    // 导致 scale 与 transform-origin 算错（位置歪、缩放幅度不对）
    const prevTransform = wrap.style.transform;
    wrap.style.transition = "none";
    wrap.style.transform = "none";
    const wr = wrap.getBoundingClientRect();
    const ir = originRect;
    let scale = 0.12;
    let ox = wr.width / 2;
    let oy = wr.height / 2;
    if (ir) {
      scale = ir.width / wr.width;
      ox = ir.left + ir.width / 2 - wr.left; // 图标中心相对面板左上角的局部坐标
      oy = ir.top + ir.height / 2 - wr.top;
    }
    wrap.style.transition = "";
    wrap.style.transform = prevTransform;
    wrap.style.setProperty("--fz-s", String(scale));
    wrap.style.setProperty("--fz-ox", `${ox}px`);
    wrap.style.setProperty("--fz-oy", `${oy}px`);

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("open"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase("exit");
    // 兜底：万一 transitionend 没触发，也确保卸载
    window.setTimeout(() => onClose(), DURATION + 120);
  }, [onClose]);

  // 收起动画播完后（transform 过渡结束）才卸载，避免「生硬消失」
  const handleTransitionEnd = React.useCallback(
    (e: React.TransitionEvent) => {
      if (
        e.target === wrapRef.current &&
        e.propertyName === "transform" &&
        phase === "exit"
      ) {
        onClose();
      }
    },
    [phase, onClose]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return (
    <div
      className={cn(
        "folder-backdrop fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-16 backdrop-blur-xl",
        phase === "open" && "is-open",
        phase === "exit" && "is-exit"
      )}
      onClick={requestClose}
    >
      <div
        ref={wrapRef}
        className={cn(
          "folder-zoom relative w-full max-w-xl",
          phase === "open" && "is-open",
          phase === "exit" && "is-exit"
        )}
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={handleTransitionEnd}
      >
        {/* 文件夹标题：绝对定位在面板正上方，不占流，保证面板严格居中 */}
        <div className="absolute -top-14 left-1/2 flex -translate-x-1/2 justify-center">
          {edit ? (
            <input
              key={folder.id}
              defaultValue={folder.name}
              maxLength={12}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== folder.name) onRename(v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-56 rounded-xl bg-black/30 px-3 py-1 text-center text-3xl font-bold text-white outline-none backdrop-blur transition-shadow focus:bg-black/40 focus:ring-2 focus:ring-primary/40"
            />
          ) : (
            <h2 className="px-3 text-3xl font-bold tracking-tight text-white drop-shadow-lg">
              {folder.name}
            </h2>
          )}
        </div>

        <LiquidGlass
          ref={panelRef}
          as="div"
          mode="rect"
          corner={32}
          scale={30}
          blur={12}
          className="liquid-glass-folder relative w-full rounded-[2rem] p-6 shadow-2xl shadow-black/30"
        >
          <div className="relative z-[3]">
            <div className="grid grid-cols-4 gap-x-2 gap-y-7 sm:grid-cols-5">
              {folder.items.map((l) => (
                <LpItem
                  key={l.id}
                  item={l}
                  edit={edit}
                  dragging={dragId === l.id}
                  onPointerDownItem={onPointerDownItem}
                  onDelete={onDeleteItem}
                />
              ))}

              {edit && (
                <button
                  data-lp-add
                  onClick={(e) => onAddLink({ x: e.clientX, y: e.clientY })}
                  className="group flex w-full flex-col items-center gap-1.5"
                >
                  <span className="flex h-[70px] w-[70px] items-center justify-center rounded-[24%] border-2 border-dashed border-white/30 text-white/70 transition-colors group-hover:border-primary/60 group-hover:text-primary">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-xs text-white/70 transition-colors group-hover:text-primary">
                    添加
                  </span>
                </button>
              )}
            </div>

            {folder.items.length === 0 && !edit && (
              <p className="py-8 text-center text-sm text-white/70 drop-shadow">空文件夹</p>
            )}
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}
