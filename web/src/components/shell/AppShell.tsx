"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Moon, Sun, LogOut, Menu, LayoutDashboard, Users2, Home, CalendarDays } from "lucide-react";
import { useAuth, useTheme } from "@/components/Providers";
import { Avatar, cx } from "@/components/ui";
import { ROLE_LABEL, canUseSales } from "@/lib/access";
import { canOpen, visibleNav } from "./nav";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { Reminders } from "./Reminders";
import { DxbImport } from "./DxbImport";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, session, me, blocked, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { if (ready && (!session || blocked)) router.replace("/login"); }, [ready, session, blocked, router]);
  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => { if (me && !canOpen(me, pathname)) router.replace("/"); }, [me, pathname, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (me && canUseSales(me) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me]);

  if (!ready || !me) {
    return <div className="min-h-dvh grid place-items-center"><div className="orb" /></div>;
  }

  const sales = canUseSales(me);
  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
        <div className="text-[19px] font-semibold tracking-tight"><span className="text-ink">Usama</span> <span className="text-accent">CRM</span></div>
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
                      "flex items-center gap-3 h-10 px-3 rounded-xl text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-200",
                      active ? "bg-sidebar-2 text-sidebar-active shadow-nav" : "text-sidebar-text hover:text-sidebar-active hover:bg-sidebar-hover",
                    )}>
                    <item.icon size={17} className={cx("transition-colors duration-200", active ? "text-accent" : "text-sidebar-muted")} />
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
    <div className="app-frame min-h-dvh lg:h-dvh lg:p-3">
      <div className="app-window min-h-dvh lg:min-h-0 lg:h-full lg:rounded-[26px] lg:overflow-hidden lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 bg-sidebar border-r border-sidebar-line relative z-10">{sidebar}</aside>

        {/* Phone/tablet drawer */}
        {drawer && (
          <div className="lg:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] scrim-in" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-line rounded-r-[26px] overflow-hidden animate-in">{sidebar}</aside>
          </div>
        )}

        <div className="relative flex-1 min-w-0 lg:overflow-y-auto">
          <div className="app-glow" />
          <header className="sticky top-0 z-30 h-16 flex items-center gap-2 px-4 sm:px-6 lg:px-8 app-header">
            <button className="lg:hidden p-2 -ml-2 rounded-full text-ink-2 hover:bg-surface-2 transition-colors" onClick={() => setDrawer(true)} aria-label="Menu"><Menu size={20} /></button>
            <button onClick={() => setPaletteOpen(true)} hidden={!sales} className="lg:hidden p-2 rounded-full text-ink-2 hover:bg-surface-2 transition-colors" aria-label="Search"><Search size={18} /></button>
            <button onClick={() => setPaletteOpen(true)}
              className={cx("hidden items-center gap-2 h-9 w-80 px-3.5 rounded-full bg-surface border border-line text-[13px] text-ink-3 hover:border-line-strong transition-colors", sales && "lg:flex")}>
              <Search size={14} /> <span className="flex-1 text-left">Search leads, owners, people…</span>
              <kbd className="text-[11px] font-medium text-ink-3 rounded-md bg-surface-2 px-1.5 py-0.5">⌘K</kbd>
            </button>
            <div className="flex-1" />
            <TodayChip />
            <ThemeToggle />
            <NotificationBell />
            <span className="hidden sm:inline-flex ml-1"><Avatar name={me.name} size={32} /></span>
          </header>
          <main className="relative px-4 sm:px-6 lg:px-8 pt-3 pb-28 lg:pb-10 max-w-[1440px] mx-auto">{children}</main>
        </div>
      </div>

      {/* Phone bottom tabs */}
      {sales && <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line rounded-t-[22px] bg-surface/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 px-1 pt-1">
          {[
            { href: "/", label: "Home", icon: LayoutDashboard },
            { href: "/leads", label: "Leads", icon: Users2 },
            { href: "/owners", label: "Owners", icon: Home },
            { href: "/calendar", label: "Calendar", icon: CalendarDays },
          ].map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} className={cx("flex flex-col items-center gap-0.5 py-1.5 text-[11px] transition-colors duration-200", active ? "text-accent-text font-medium" : "text-ink-3")}>
                <span className={cx("grid place-items-center h-7 w-12 rounded-full transition-colors duration-200", active && "bg-accent-soft")}><t.icon size={19} /></span>
                {t.label}
              </Link>
            );
          })}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-1.5 text-[11px] text-ink-3">
            <span className="grid place-items-center h-7 w-12"><Menu size={19} /></span> More
          </button>
        </div>
      </nav>}

      {sales && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
      {sales && <Reminders />}
      <DxbImport />
    </div>
  );
}

function TodayChip() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(new Date()).replace(",", "").toUpperCase());
  }, []);
  if (!label) return null;
  return (
    <span className="hidden md:inline-flex items-center gap-2 h-9 px-3 text-[11px] font-medium tracking-[0.06em] text-ink-2 num">
      <span className="live-dot size-1.5 rounded-full bg-accent" /> {label}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button onClick={() => setTheme(dark ? "light" : "dark")} title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Light mode" : "Dark mode"}
      className="p-2 rounded-full text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function UserMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-2.5 rounded-2xl bg-sidebar-2 shadow-nav p-2.5">
        <Avatar name={name} size={32} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-sidebar-active truncate">{name}</div>
          <div className="text-[11px] text-ink-3 truncate">{role}</div>
        </div>
        <button onClick={onSignOut} title="Sign out" aria-label="Sign out" className="p-1.5 rounded-full text-sidebar-muted hover:text-sidebar-active hover:bg-sidebar-hover transition-colors"><LogOut size={15} /></button>
      </div>
    </div>
  );
}
