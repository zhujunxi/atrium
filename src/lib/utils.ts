import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 从标题哈希出一组稳定的渐变配色，用于字母头像 */
const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-500",
  "from-violet-500 to-purple-500",
  "from-pink-500 to-rose-500",
  "from-orange-500 to-amber-500",
  "from-emerald-500 to-teal-500",
  "from-cyan-500 to-sky-500",
  "from-fuchsia-500 to-pink-500",
  "from-lime-500 to-green-500",
];

export function gradientFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * 日期戳（YYYY-MM-DD）→ 按界面语言格式化。
 * full：中文「2026年9月1日」/ 英文「Sep 1, 2026」；short：中文「9月1日」/ 英文「Sep 1」。
 * 手工按年月日构造本地日期，避开 new Date("YYYY-MM-DD") 按 UTC 解析、
 * 在东八区以西整体退一天的问题（日期戳是纯日历日，不含时区）。
 */
export function formatDayStamp(
  date: string,
  locale: string,
  style: "full" | "short" = "full"
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: style === "full" ? "numeric" : undefined,
    month: locale === "zh-CN" ? "long" : "short",
    day: "numeric",
  }).format(dt);
}

