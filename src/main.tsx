import * as React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { DesktopBackground } from "@/components/desktop-background";
import { NavApp } from "@/components/nav-app";
import { loadNav, loadMode } from "@/lib/store";
import { loadChromeNav, hasBookmarksApi } from "@/lib/bookmarks";
import type { NavData } from "@/lib/types";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

/**
 * 扩展新标签页根组件：客户端异步读数据。
 * 关键：同步模式下先读 Chrome 收藏夹再渲染，避免「先本地后同步」的闪烁。
 */
function App() {
  const [data, setData] = React.useState<NavData | null>(null);
  const [syncMode, setSyncMode] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const mode = await loadMode();
      const isSync = mode === "sync" && hasBookmarksApi();
      let nav: NavData;
      if (isSync) {
        try {
          nav = { items: await loadChromeNav(), updatedAt: new Date().toISOString() };
        } catch {
          nav = await loadNav();
        }
      } else {
        nav = await loadNav();
      }
      if (!active) return;
      setData(nav);
      setSyncMode(isSync);
    })().catch(() => {
      if (!active) return;
      setData({ items: [], updatedAt: new Date().toISOString() });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
      <I18nProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <DesktopBackground />
          {data && <NavApp initialData={data} initialSyncMode={syncMode} />}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
