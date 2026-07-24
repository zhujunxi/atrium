"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/types";
import { AppIcon, FolderIcon } from "@/components/app-icon";

/** 由 id 确定性算出抖动相位，避免 SSR 与客户端不一致 */
function jiggleDelay(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 25) / 100;
}

interface LpItemProps {
  item: NavItem;
  edit: boolean;
  /** 正被拖拽：原位渲染为半透明占位 */
  dragging?: boolean;
  /** 拖拽悬停合并预览（叠放建文件夹） */
  mergeTarget?: boolean;
  /** 拖拽悬停放入文件夹预览 */
  folderTarget?: boolean;
  onPointerDownItem: (e: React.PointerEvent, item: NavItem) => void;
  onDelete: (item: NavItem) => void;
}

/** memo：翻页码/搜索等外层重渲染时跳过图标树；props 需稳定（回调已 useCallback） */
export const LpItem = React.memo(function LpItem({
  item,
  edit,
  dragging,
  mergeTarget,
  folderTarget,
  onPointerDownItem,
  onDelete,
}: LpItemProps) {
  const title = item.type === "link" ? item.title : item.name;

  return (
    <div
      data-lp-id={item.id}
      data-lp-type={item.type}
      role="button"
      tabIndex={-1}
      onPointerDown={(e) => onPointerDownItem(e, item)}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "group relative flex w-full cursor-pointer select-none flex-col items-center gap-3 outline-none",
        edit && "touch-none",
        dragging && "opacity-25"
      )}
    >
      <span
        style={edit ? { animationDelay: `${jiggleDelay(item.id)}s` } : undefined}
        className={cn(
          "relative rounded-[24%] transition-[transform,box-shadow] duration-200",
          edit && "animate-jiggle",
          !edit && !dragging && "group-hover:-translate-y-1 group-hover:shadow-[0_4px_8px_rgba(0,0,0,0.12),0_14px_28px_rgba(0,0,0,0.2)]",
          (mergeTarget || folderTarget) && "scale-110"
        )}
      >
        {item.type === "link" ? (
          <AppIcon
            link={item}
            className={cn(
              mergeTarget && "ring-4 ring-primary/60"
            )}
          />
        ) : (
          <FolderIcon
            name={item.name}
            items={item.items}
            className={cn(
              folderTarget && "ring-4 ring-primary/60"
            )}
          />
        )}

        {edit && (
          <button
            type="button"
            aria-label={item.type === "link" ? `删除 ${title}` : `解散文件夹 ${title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            className="absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-400/90 text-white shadow ring-1 ring-black/10 backdrop-blur transition-colors hover:bg-red-500 dark:bg-zinc-600/90 dark:ring-white/20"
          >
            <X className="h-3 w-3" strokeWidth={3} />
          </button>
        )}
      </span>

      <span className="max-w-full truncate text-center text-xs leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
        {title}
      </span>
    </div>
  );
});
