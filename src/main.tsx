import * as React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { DesktopBackground } from "@/components/desktop-background";
import { NavApp } from "@/components/nav-app";
import { loadNav, loadMode } from "@/lib/store";
import type { NavData } from "@/lib/types";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

/** 扩展新标签页根组件：替代原 Next 的 layout.tsx + page.tsx（SSR 读数据 → 改为客户端异步读 storage） */
function App() {
  const [data, setData] = React.useState<NavData | null>(null);
  const [syncMode, setSyncMode] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    Promise.all([loadNav(), loadMode()])
      .then(([nav, mode]) => {
        if (!active) return;
        setData(nav);
        setSyncMode(mode === "sync");
      })
      .catch(() => {
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
