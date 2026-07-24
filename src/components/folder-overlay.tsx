"use client";

import * as React from "react";
import { ChevronLeft, FolderPlus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavFolder, NavItem } from "@/lib/types";
import { LpItem } from "@/components/lp-item";
import { FolderIcon } from "@/components/app-icon";
import { LiquidGlass } from "@/components/liquid-glass";
import { useI18n } from "@/lib/i18n";

interface FolderOverlayProps {
  folder: NavFolder;
  /** 完整的实时导航树：下钻栈只存文件夹 id，当前层始终从最新数据解析，
   *  保证在展开层内增删/改名后界面立即刷新（不依赖重新打开） */
  items: NavItem[];
  edit: boolean;
  dragId: string | null;
  /** 面板 DOM 引用：拖拽落点判定（落在面板外 = 移出文件夹） */
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 打开该文件夹的图标屏幕坐标：用于 macOS 式从图标缩放展开/收起 */
  originRect: DOMRect | null;
  onPointerDownItem: (e: React.PointerEvent, item: NavItem) => void;
  onDeleteItem: (item: NavItem) => void;
  onRename: (id: string, name: string) => void;
  onAddLink: (origin?: { x: number; y: number }) => void;
  onAddFolder: (parentId: string) => void;
  /** 收起动画结束后由父组件卸载 */
  onClose: () => void;
}

/** 动画时长，需与 globals.css 中 .folder-zoom / .folder-backdrop 的 transition 对齐 */
const DURATION = 300;

type Phase = "enter" | "open" | "exit";

/** 在树中按 id 递归查找文件夹（用于从实时数据解析下钻栈） */
function findFolder(items: NavItem[], id: string): NavFolder | null {
  for (const i of items) {
    if (i.type === "folder" && i.id === id) return i;
    if (i.type === "folder") {
      const r = findFolder(i.items, id);
      if (r) return r;
    }
  }
  return null;
}

/** macOS Launchpad 风格文件夹展开层：从图标缩放展开，收起时缩回图标。
 *  支持嵌套：点击子文件夹可下钻，顶部面包屑可返回上层。 */
export function FolderOverlay({
  folder,
  items,
  edit,
  dragId,
  panelRef,
  originRect,
  onPointerDownItem,
  onDeleteItem,
  onRename,
  onAddLink,
  onAddFolder,
  onClose,
}: FolderOverlayProps) {
  const { t } = useI18n();
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = React.useState<Phase>("enter");
  const closingRef = React.useRef(false);
  // 下钻栈：只存文件夹 id，当前层从实时 items 解析
  const [stack, setStack] = React.useState<string[]>([folder.id]);
  const current = findFolder(items, stack[stack.length - 1]) ?? folder;

  // 挂载即把「缩到图标处的初始态」写进 CSS 变量，再用双 rAF 切到展开态触发过渡
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
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
      ox = ir.left + ir.width / 2 - wr.left;
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
    window.setTimeout(() => onClose(), DURATION + 120);
  }, [onClose]);

  const handleTransitionEnd = React.useCallback(
    (e: React.TransitionEvent) => {
      if (e.target === wrapRef.current && e.propertyName === "transform" && phase === "exit") {
        onClose();
      }
    },
    [phase, onClose]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (stack.length > 1) setStack((s) => s.slice(0, -1));
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, requestClose]);

  return (
    <div
      className={cn(
        "folder-backdrop fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-16 backdrop-blur-xl",
        phase === "open" && "is-open",
        phase === "exit" && "is-exit"
      )}
      onClick={() => {
        // 处于子文件夹时，点背景先退回上一层；仅在顶层文件夹才收起到桌面
        if (stack.length > 1) setStack((s) => s.slice(0, -1));
        else requestClose();
      }}
    >
      {stack.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStack((s) => s.slice(0, -1));
          }}
          aria-label={t("a11y.back")}
          className="fixed left-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition-colors hover:bg-black/45"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

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
        {/* 面包屑：点击可返回对应层级 */}
        {stack.length > 1 && (
          <div className="absolute -top-24 left-1/2 flex max-w-full -translate-x-1/2 flex-wrap justify-center gap-1 text-xs text-white/80">
            {stack.map((id, i) => {
              const name = findFolder(items, id)?.name ?? folder.name;
              return (
                <React.Fragment key={id}>
                  {i > 0 && <span className="text-white/40">/</span>}
                  <button
                    type="button"
                    onClick={() => setStack((st) => st.slice(0, i + 1))}
                    className="rounded-full bg-black/30 px-2 py-0.5 backdrop-blur transition-colors hover:bg-black/45"
                  >
                    {name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* 文件夹标题：绝对定位在面板正上方，不占流，保证面板严格居中 */}
        <div className="absolute -top-14 left-1/2 flex -translate-x-1/2 justify-center">
          {edit ? (
            <input
              key={current.id}
              defaultValue={current.name}
              maxLength={12}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== current.name) onRename(current.id, v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-56 rounded-xl bg-black/30 px-3 py-1 text-center text-3xl font-bold text-white outline-none backdrop-blur transition-shadow focus:bg-black/40 focus:ring-2 focus:ring-primary/40"
            />
          ) : (
            <h2 className="px-3 text-3xl font-bold tracking-tight text-white drop-shadow-lg">
              {current.name}
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
          <div className="relative z-[3] max-h-[72vh] overflow-y-auto pr-1">
            <div key={current.id} className="grid grid-cols-4 gap-x-2 gap-y-7 sm:grid-cols-5">
              {current.items.map((it) =>
                it.type === "link" ? (
                  <LpItem
                    key={it.id}
                    item={it}
                    edit={edit}
                    dragging={dragId === it.id}
                    onPointerDownItem={onPointerDownItem}
                    onDelete={onDeleteItem}
                  />
                ) : (
                  <div
                    key={it.id}
                    data-lp-id={it.id}
                    data-lp-type="folder"
                    role="button"
                    tabIndex={-1}
                    onClick={() => !edit && setStack((s) => [...s, it.id])}
                    className="group relative flex w-full cursor-pointer select-none flex-col items-center gap-3 outline-none"
                  >
                    <span className="relative rounded-[24%] transition-[transform,box-shadow] duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_4px_8px_rgba(0,0,0,0.12),0_14px_28px_rgba(0,0,0,0.2)]">
                      <FolderIcon name={it.name} items={it.items} />
                      {edit && (
                        <button
                          type="button"
                          aria-label={t("a11y.dissolveFolder", { title: it.name })}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteItem(it);
                          }}
                          className="absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-400/90 text-white shadow ring-1 ring-black/10 backdrop-blur transition-colors hover:bg-red-500 dark:bg-zinc-600/90 dark:ring-white/20"
                        >
                          <X className="h-3 w-3" strokeWidth={3} />
                        </button>
                      )}
                    </span>
                    <span className="max-w-full truncate text-center text-xs leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
                      {it.name}
                    </span>
                  </div>
                )
              )}

              {edit && (
                <>
                  <button
                    data-lp-add
                    onClick={(e) => onAddLink({ x: e.clientX, y: e.clientY })}
                    className="group flex w-full flex-col items-center gap-1.5"
                  >
                    <span className="flex h-[70px] w-[70px] items-center justify-center rounded-[24%] border-2 border-dashed border-white/30 text-white/70 transition-colors group-hover:border-primary/60 group-hover:text-primary">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-white/70 transition-colors group-hover:text-primary">
                      {t("common.add")}
                    </span>
                  </button>
                  <button
                    data-lp-add-folder
                    onClick={() => onAddFolder(current.id)}
                    className="group flex w-full flex-col items-center gap-1.5"
                  >
                    <span className="flex h-[70px] w-[70px] items-center justify-center rounded-[24%] border-2 border-dashed border-white/30 text-white/70 transition-colors group-hover:border-primary/60 group-hover:text-primary">
                      <FolderPlus className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-white/70 transition-colors group-hover:text-primary">
                      {t("common.newFolder")}
                    </span>
                  </button>
                </>
              )}
            </div>

            {current.items.length === 0 && !edit && (
              <p className="py-8 text-center text-sm text-white/70 drop-shadow">{t("folder.empty")}</p>
            )}
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}
