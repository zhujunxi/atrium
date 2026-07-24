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

