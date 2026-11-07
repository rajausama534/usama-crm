"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Active staff (for "assigned to" pickers). Agents only get their own row back (RLS). */
export function useStaff() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["staff"],
    enabled: !!me,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // crm_staff_directory() (migration 20261108100000) lets everyone see colleagues' names; before it
      // exists, admins read user_access directly and agents only get their own row.
      const dir = await db.rpc("crm_staff_directory");
      if (!dir.error) return (dir.data || []) as { email: string; name: string | null; role: string | null; team_leader?: string | null }[];
      const { data } = await db.from("user_access").select("email,name,role,active").order("name");
      return (data || []).filter((u) => u.active !== false) as { email: string; name: string | null; role: string | null; team_leader?: string | null }[];
    },
  });
}

export function staffName(list: { email: string; name: string | null }[] | undefined, email: string | null | undefined) {
  if (!email) return "Unassigned";
  const u = list?.find((s) => s.email.toLowerCase() === email.toLowerCase());
  return u?.name || email.split("@")[0];
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await db.from("crm_projects").select("name").order("name");
      return (data || []).map((p) => p.name as string);
    },
  });
}
