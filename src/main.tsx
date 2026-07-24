import * as React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { DesktopBackground } from "@/components/desktop-background";
import { NavApp } from "@/components/nav-app";
import { loadNav } from "@/lib/store";
import type { NavData } from "@/lib/types";
import "./globals.css";

/** 扩展新标签页根组件：替代原 Next 的 layout.tsx + page.tsx（SSR 读数据 → 改为客户端异步读 storage） */
function App() {
  const [data, setData] = React.useState<NavData | null>(null);

  React.useEffect(() => {
    loadNav().then(setData).catch(() => setData({ items: [], updatedAt: new Date().toISOString() }));
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DesktopBackground />
      {data && <NavApp initialData={data} />}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
