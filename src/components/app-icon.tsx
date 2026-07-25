"use client";

import { useState, useEffect } from "react";
import { cn, gradientFor } from "@/lib/utils";
import { useFavicon } from "@/lib/favicon";
import type { NavItem, NavLink } from "@/lib/types";
import { LiquidGlass } from "@/components/liquid-glass";

/**
 * macOS 风格应用图标：
 * - 图标全出血填充 squircle（22.5% 连续圆角），无白边白底；
 * - 表面叠加液态玻璃蒙版（顶部高光 + 边缘内发光，见 globals.css .icon-glass）；
 * - favicon 加载失败时回退为渐变字母图标。
 */
export function AppIcon({
  link,
  size = 70,
  className,
}: {
  link: NavLink;
  size?: number;
  className?: string;
}) {
  const { candidates, forceLetter } = useFavicon(link.url);
  const [srcIndex, setSrcIndex] = useState(0);
  const [useLetter, setUseLetter] = useState(false);
  const letter = (link.title.trim()[0] || "·").toUpperCase();
  // 已知无图标（负缓存命中）直接字母头像；切换链接时重置回退状态，避免沿用旧图
  useEffect(() => {
    setSrcIndex(0);
    setUseLetter(forceLetter);
  }, [link.url, forceLetter]);
  // 支持外层通过 --lp-icon 响应式覆盖尺寸；默认回退到传入的 size
  const sizeVar = `var(--lp-icon, ${size}px)`;

  return (
    <span
      style={{ width: sizeVar, height: sizeVar }}
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-[24%]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.08] dark:ring-white/10",
        className
      )}
    >
    {/* 加载成功：白色底（favicon 透明区域透出白底，更接近真实 app 图标观感） */}
    {!useLetter && <span className="absolute inset-0 bg-white" />}
    {/* 字母头像兜底：仅当所有 favicon 都加载失败时，才显示彩色渐变 + 首字母 */}
    {useLetter && (
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-gradient-to-br font-semibold text-white",
          gradientFor(link.title)
        )}
        style={{ fontSize: `calc(${sizeVar} * 0.42)` }}
      >
        {letter}
      </span>
    )}
    {/* 网站图标：方形 touch-icon 会全出血铺满；glyph 型 favicon 则等比填满 */}
    {!useLetter && candidates[srcIndex] && (
      <span className="absolute inset-[15%]">
        <img
          src={candidates[srcIndex]}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            const next = srcIndex + 1;
            if (next < candidates.length) setSrcIndex(next);
            else setUseLetter(true);
          }}
          className="h-full w-full object-contain"
        />
      </span>
    )}
      {/* 液态玻璃质感蒙版 */}
      <span aria-hidden className="icon-glass pointer-events-none absolute inset-0" />
    </span>
  );
}

/** 文件夹内迷你预览图标（3x3 宫格用），样式与主图标一致：成功白底 + favicon，失败才渐变 + 首字母 */
function MiniIcon({ link, size }: { link: NavLink; size: number | string }) {
  const { candidates, forceLetter } = useFavicon(link.url);
  const [srcIndex, setSrcIndex] = useState(0);
  const [useLetter, setUseLetter] = useState(false);
  const letter = (link.title.trim()[0] || "·").toUpperCase();
  // 已知无图标（负缓存命中）直接字母头像；切换链接时重置回退状态，避免沿用旧图
  useEffect(() => {
    setSrcIndex(0);
    setUseLetter(forceLetter);
  }, [link.url, forceLetter]);
  const fontSize = typeof size === "number" ? size * 0.5 : `calc(${size} * 0.5)`;
  return (
    <span
      style={{ width: size, height: size }}
      className="relative block overflow-hidden rounded-[28%] bg-white shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10"
    >
      {/* 加载成功：白底 + favicon 居中略缩 */}
      {!useLetter && (
        <span className="absolute inset-[15%]">
          {candidates[srcIndex] && (
            <img
              src={candidates[srcIndex]}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => {
                const next = srcIndex + 1;
                if (next < candidates.length) setSrcIndex(next);
                else setUseLetter(true);
              }}
              className="h-full w-full object-contain"
            />
          )}
        </span>
      )}
      {/* 字母头像兜底：仅当所有 favicon 都加载失败时显示 */}
        {useLetter && (
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-gradient-to-br text-white",
              gradientFor(link.title)
            )}
            style={{ fontSize: fontSize }}
          >
            {letter}
          </span>
        )}
    </span>
  );
}

/** macOS 文件夹图标：液态玻璃底板（真折射 + 细边，与设置菜单同款）+ 3x3 迷你图标宫格 */
export function FolderIcon({
  name,
  items,
  size = 70,
  className,
}: {
  name: string;
  /** 可嵌套：链接与子文件夹混排；预览宫格只取其中的链接 */
  items: NavItem[];
  size?: number;
  className?: string;
}) {
  const preview = items
    .filter((i): i is NavLink => i.type === "link")
    .slice(0, 9);
  // 允许外层通过 --lp-icon 覆盖尺寸；保持原 size 作为回退
  const sizeVar = `var(--lp-icon, ${size}px)`;
  const pad = `calc(${sizeVar} * 0.15)`;
  const gap = `calc(${sizeVar} * 0.08)`;
  const cell = `calc(${sizeVar} * 0.18)`; // (1 - 0.15*2 - 0.08*2) / 3 = 0.18

  return (
    <LiquidGlass
      as="span"
      mode="rect"
      corner={size * 0.24}
      scale={8}
      blur={3}
      style={{ width: sizeVar, height: sizeVar, padding: pad }}
      className={cn(
        "liquid-glass-folder relative block shrink-0 rounded-[24%]",
        className
      )}
    >
      {preview.length > 0 ? (
        <span className="relative z-[3] grid h-full w-full grid-cols-3 place-content-start place-items-center" style={{ gap }}>
          {preview.map((l) => (
            <MiniIcon key={l.id} link={l} size={cell} />
          ))}
        </span>
      ) : (
        <span className="relative z-[3] flex h-full w-full items-center justify-center text-muted-foreground/70" style={{ fontSize: `calc(${sizeVar} * 0.3)` }}>
          {(name.trim()[0] || "·").toUpperCase()}
        </span>
      )}
    </LiquidGlass>
  );
}
