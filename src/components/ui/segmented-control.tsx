"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  key: T;
  label: React.ReactNode;
  /** 传入图标组件则竖向排布（图标在上、文字在下）；不传则为单行文字。 */
  icon?: React.ComponentType<{ className?: string }>;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (key: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-0.5 rounded-2xl bg-black/15 p-0.5",
        className
      )}
    >
      {options.map((opt) => {
        const isActive = value === opt.key;
        const Icon = opt.icon;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex flex-1 items-center justify-center rounded-xl py-1 text-[11px] transition-colors",
              Icon ? "flex-col gap-0.5" : "gap-0",
              isActive
                ? "bg-white/25 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
                : "text-white/60 hover:text-white"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
