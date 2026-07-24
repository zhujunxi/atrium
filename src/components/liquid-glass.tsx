"use client";

import * as React from "react";
import { makeGlassDisplacementMap } from "@/lib/glass";
import { cn } from "@/lib/utils";

type Props = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  mode?: "circle" | "rect";
  /** 圆角半径（px），mode=rect 时生效 */
  corner?: number;
  /** 折射带宽度 = 半径 * bandRatio */
  bandRatio?: number;
  /** feDisplacementMap 的 scale，越大边缘弯折越强 */
  scale?: number;
  /** backdrop 模糊半径（px），面板需要明显磨砂、按钮可很小 */
  blur?: number;
  /** 纯模糊：去掉 saturate/brightness 调整（用于无色调玻璃） */
  plain?: boolean;
  /** 当 as="button" 时透传 type */
  type?: "button" | "submit" | "reset";
};

export const LiquidGlass = React.forwardRef<HTMLElement, Props>(function LiquidGlass(
  {
    as: Tag = "div",
    mode = "rect",
    corner = 24,
    bandRatio = 0.55,
    scale = 32,
    blur = 0.5,
    plain = false,
    className,
    children,
    style,
    ...rest
  },
  forwardedRef
) {
  const ref = React.useRef<HTMLElement | null>(null);
  const feRef = React.useRef<SVGFEImageElement | null>(null);
  // 用 useId 生成 SSR 安全的唯一 id，避免服务端/客户端计数器不一致导致的 hydration 警告
  const idRef = `lg-${React.useId().replace(/:/g, "")}`;

  const setRef = React.useCallback(
    (node: HTMLElement | null) => {
      ref.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef)
        (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [forwardedRef]
  );

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const build = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width));
      const h = Math.max(2, Math.round(rect.height));
      const radius = mode === "circle" ? Math.min(w, h) / 2 : corner;
      const data = makeGlassDisplacementMap(w, h, mode, corner, radius * bandRatio);
      if (feRef.current && data) feRef.current.setAttribute("href", data);

      // 支持 url() 的 backdrop-filter 才启用真折射，否则走 CSS 毛玻璃降级
      const supports =
        (typeof CSS !== "undefined" &&
          (CSS.supports("backdrop-filter", `url(#${idRef}) blur(0.4px)`) ||
            CSS.supports("-webkit-backdrop-filter", `url(#${idRef}) blur(0.4px)`)));
      // 把模糊半径 / 色调微调拆成 CSS 变量，backdrop-filter 统一走 var(--lg-filter)。
      // 各组件自己的 --lg-blur / --lg-extra 由 props 决定，翻页等场景如需临时调整
      // 折射，只需重写 --lg-filter 即可，无需再逐处改内联样式。
      const urlPart = supports ? `url(#${idRef}) ` : "";
      const extra = plain ? "" : " saturate(180%) brightness(1.06)";
      el.style.setProperty("--lg-blur", `${blur}px`);
      el.style.setProperty("--lg-extra", extra);
      el.style.setProperty("--lg-filter", `${urlPart}blur(var(--lg-blur))${extra}`);
      const s = el.style as React.CSSProperties & { backdropFilter?: string; webkitBackdropFilter?: string };
      s.backdropFilter = "var(--lg-filter)";
      s.webkitBackdropFilter = "var(--lg-filter)";
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, corner, bandRatio, scale, blur, plain]);

  return (
    <>
      <Tag ref={setRef as React.Ref<HTMLElement>} className={cn("liquid-glass", className)} style={style} {...rest}>
        {children}
      </Tag>
      <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
        <defs>
          <filter id={idRef} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feImage ref={feRef as React.Ref<SVGFEImageElement>} result="map" width="100%" height="100%" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
    </>
  );
});
