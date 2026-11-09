"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/lib/supabase";
import { resolveMe, type AccessRow, type Me } from "@/lib/access";

type AuthState = {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  /** Logged in, but no active user_access row (deactivated or never added). */
  blocked: boolean;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({ ready: false, session: null, me: null, blocked: false, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
    }),
  );

  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(false);

  const loadAccess = useCallback(async (s: Session | null) => {
    if (!s?.user?.email) { setMe(null); setBlocked(false); setReady(true); return; }
    const email = s.user.email;
    const { data } = await db.from("user_access").select("*").ilike("email", email).maybeSingle<AccessRow>();
    const resolved = resolveMe(email, data);
    const isBlocked = !resolved.isSuperAdmin && (!data || data.active === false);
    setMe(isBlocked ? null : resolved);
    setBlocked(isBlocked);
    setReady(true);
  }, []);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => { setSession(data.session); loadAccess(data.session); });
    const { data: sub } = db.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadAccess(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAccess]);

  const signOut = useCallback(async () => { await db.auth.signOut(); client.clear(); }, [client]);
  const auth = useMemo(() => ({ ready, session, me, blocked, signOut }), [ready, session, me, blocked, signOut]);

  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => { setThemeState(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem("crm_theme", t); } catch {}
    const apply = () => { document.documentElement.dataset.theme = t; };
    // Cross-fade between themes where the browser supports it.
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(apply);
    else apply();
  }, []);
  const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <QueryClientProvider client={client}>
      <ThemeCtx.Provider value={themeValue}>
        <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>
      </ThemeCtx.Provider>
    </QueryClientProvider>
  );
}
