import { AppShell } from "@/components/shell/AppShell";
import { ToastHost } from "@/components/ContactKit";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ToastHost><AppShell>{children}</AppShell></ToastHost>;
}
