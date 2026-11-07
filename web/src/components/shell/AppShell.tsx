"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Moon, Sun, LogOut, Menu, LayoutDashboard, Users2, Home, CalendarDays } from "lucide-react";
import { useAuth, useTheme } from "@/components/Providers";
import { cx } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/access";
import { visibleNav } from "./nav";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, session, me, blocked, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { if (ready && (!session || blocked)) router.replace("/login"); }, [ready, session, blocked, router]);
  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || !me) {
    return <div className="min-h-dvh grid place-items-center"><div className="size-8 rounded-xl bg-gold/70 animate-pulse" /></div>;
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
        <div className="text-[20px] font-bold tracking-tight"><span className="text-ink">Usama</span> <span className="text-accent">CRM</span></div>
      </div>
      <div className="px-3 pb-2">
        <button onClick={() => setPaletteOpen(true)}
          className="flex w-full items-center gap-2 h-9 px-3 rounded-lg bg-surface-2 border border-line text-sm text-ink-3 hover:border-line-strong transition-colors">
          <Search size={14} /> <span className="flex-1 text-left">Search</span>
          <kbd className="text-[11px] font-medium text-sidebar-muted">⌘K</kbd>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-5">
        {visibleNav(me).map((section, i) => (
          <div key={i}>
            {section.title && <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">{section.title}</div>}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} prefetch
                    className={cx(
                      "relative flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors",
                      active ? "bg-sidebar-2 text-sidebar-active font-medium" : "text-sidebar-text hover:text-sidebar-active hover:bg-sidebar-hover",
                    )}>
                    {active && <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg bg-accent" />}
                    <item.icon size={18} className={active ? "text-accent" : "text-sidebar-muted"} />
                    <span className="flex-1">{item.label}</span>
                    {item.soon && <span className="text-[10px] font-medium text-sidebar-muted">Soon</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <UserMenu name={me.name} role={ROLE_LABEL[me.role]} onSignOut={signOut} />
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-sidebar border-r border-sidebar-line">{sidebar}</aside>

      {/* Phone/tablet drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-line animate-in">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 h-14 flex items-center gap-2 px-4 sm:px-6 border-b border-line bg-bg/85 backdrop-blur-md">
          <button className="lg:hidden p-1.5 -ml-1.5 rounded-md text-ink-2 hover:bg-surface-2" onClick={() => setDrawer(true)} aria-label="Menu"><Menu size={20} /></button>
          <button onClick={() => setPaletteOpen(true)} className="lg:hidden p-1.5 rounded-md text-ink-2 hover:bg-surface-2" aria-label="Search"><Search size={18} /></button>
          <div className="flex-1" />
          <NotificationBell />
        </header>
        <main className="px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-10 max-w-[1400px] mx-auto">{children}</main>
      </div>

      {/* Phone bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-surface/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {[
            { href: "/", label: "Home", icon: LayoutDashboard },
            { href: "/leads", label: "Leads", icon: Users2 },
            { href: "/owners", label: "Owners", icon: Home },
            { href: "/calendar", label: "Calendar", icon: CalendarDays },
          ].map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-accent font-medium" : "text-ink-3")}>
                <t.icon size={20} /> {t.label}
              </Link>
            );
          })}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-3">
            <Menu size={20} /> More
          </button>
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function UserMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : "light";
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  return (
    <div className="border-t border-sidebar-line p-3 flex items-center gap-2.5">
      <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text text-xs font-semibold">{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-sidebar-active truncate">{name}</div>
        <div className="text-xs text-ink-3 truncate">{role}</div>
      </div>
      <button onClick={() => setTheme(next)} title={theme === "dark" ? "Light mode" : "Dark mode"} className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-active hover:bg-sidebar-hover"><ThemeIcon size={16} /></button>
      <button onClick={onSignOut} title="Sign out" className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-active hover:bg-sidebar-hover"><LogOut size={16} /></button>
    </div>
  );
}
