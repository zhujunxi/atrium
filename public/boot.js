/**
 * 首帧防白闪引导脚本（非 module，阻塞执行——在任何像素上屏之前完成）。
 *
 * MV3 CSP 禁止内联 <script>，但允许扩展包内的本地脚本；本文件同步读
 * localStorage（chrome.storage 只有异步 API，注定赶不上首帧）：
 * 1. 预置主题类：next-themes 的防闪内联脚本被 CSP 拦截，主题类原本要等
 *    React 挂载后才加上——暗色用户会先看到一帧浅色。这里提前补上 .dark。
 * 2. 预置背景：用上次壁纸的极小缩略图（saveWallpaperBackdrop 双写到
 *    localStorage 的 dataURL）铺满 body，浏览器放大插值天然模糊，
 *    观感 = 「模糊壁纸 → 清晰壁纸」，全程无白屏。
 *
 * 层叠关键：背景必须设在 body 上、且置于 body 内执行。body 背景会被 CSS
 * 上提到画布层（canvas）绘制，位于 -z-10 壁纸层之下；若设在 html 上，
 * 上提机制被关闭，body 自身不透明的 bg-background 将反过来盖住壁纸层。
 * 冷启动（无任何缓存）回退主题对应的纯色底。
 */
(function () {
  try {
    var theme = localStorage.getItem("theme");
    var dark =
      theme === "dark" ||
      ((!theme || theme === "system") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
    // 与 globals.css 的 --background 对应：dark = hsl(224 40% 6%)，light = hsl(220 33% 98%)
    var themeBase = dark ? "#090B15" : "#F9FAFC";
    // 优先用壁纸平均色作首帧底色：避免浅色主题下 #F9FAFC 在模糊图解码前抢先画一帧白。
    // 该色由 saveWallpaperBackdrop 在生成兜底图时一并采样写入。
    var color = localStorage.getItem("wp:backdrop-color");
    // 仅接受 "r,g,b" 格式，避免脏值让整条 background 简写失效（退化成无图白底）。
    var base =
      /^\d{1,3},\d{1,3},\d{1,3}$/.test(color || "")
        ? "rgb(" + color + ")"
        : themeBase;
    var bg = localStorage.getItem("wp:backdrop") || "";
    document.body.style.background = bg
      ? base + ' url("' + bg + '") center / cover no-repeat'
      : base;
  } catch (e) {
    /* localStorage 不可用等异常：保持默认，不阻断加载 */
  }
})();
