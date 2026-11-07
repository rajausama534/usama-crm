"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Home, Users2, Search, CornerDownLeft } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { visibleNav } from "./nav";

/** Text safe to put inside a PostgREST or() filter. */
export function orSafe(s: string) {
  return s.replace(/[,()*%\\]/g, " ").trim();
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const term = orSafe(useDebounced(q, 200));

  useEffect(() => { if (!open) setQ(""); }, [open]);

  const results = useQuery({
    queryKey: ["search", term],
    enabled: open && term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const digits = term.replace(/\D/g, "");
      const ownerOr = [`owner.ilike.%${term}%`, `unit.ilike.%${term}%`];
      const leadOr = [`name.ilike.%${term}%`];
      if (digits.length >= 4) {
        ownerOr.push(`phone1.ilike.%${digits}%`, `phone2.ilike.%${digits}%`);
        leadOr.push(`phone.ilike.%${digits}%`);
      }
      const [owners, leads] = await Promise.all([
        db.from("owners").select("id,owner,community,cluster,unit").or(ownerOr.join(",")).limit(7),
        db.from("leads").select("id,name,phone,status,project_inquired").or(leadOr.join(",")).limit(6),
      ]);
      return { owners: owners.data || [], leads: leads.data || [] };
    },
  });

  function go(href: string) { onOpenChange(false); router.push(href); }
  if (!open || !me) return null;

  const pages = visibleNav(me).flatMap((s) => s.items).filter((i) => !i.soon);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />
      <div className="absolute left-1/2 top-[12vh] w-[calc(100%-32px)] max-w-xl -translate-x-1/2 animate-in">
        <Command shouldFilter={false} className="rounded-2xl border border-line bg-surface shadow-pop overflow-hidden"
          onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}>
          <div className="flex items-center gap-2.5 px-4 border-b border-line">
            <Search size={16} className="text-ink-3" />
            <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search owners, units, phones, leads…"
              className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 outline-none" />
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            {term.length < 2 && (
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3">
                {pages.map((p) => (
                  <Item key={p.href} onSelect={() => go(p.href)}><p.icon size={16} className="text-ink-3" />{p.label}</Item>
                ))}
              </Command.Group>
            )}
            {term.length >= 2 && results.isFetching && !results.data && <div className="px-3 py-6 text-sm text-ink-3">Searching…</div>}
            {term.length >= 2 && results.data && !results.data.owners.length && !results.data.leads.length && (
              <Command.Empty className="px-3 py-6 text-sm text-ink-3">Nothing found for “{term}”.</Command.Empty>
            )}
            {!!results.data?.leads.length && term.length >= 2 && (
              <Command.Group heading="Leads" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3">
                {results.data.leads.map((l) => (
                  <Item key={l.id} onSelect={() => go(`/leads?open=${l.id}`)}>
                    <Users2 size={16} className="text-ink-3" />
                    <span className="flex-1 truncate">{l.name || "Unnamed"} <span className="text-ink-3">· {l.project_inquired || l.phone}</span></span>
                    <span className="text-xs text-ink-3">{l.status}</span>
                  </Item>
                ))}
              </Command.Group>
            )}
            {!!results.data?.owners.length && term.length >= 2 && (
              <Command.Group heading="Owners" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3">
                {results.data.owners.map((o) => (
                  <Item key={o.id} onSelect={() => go(`/owners?open=${o.id}`)}>
                    <Home size={16} className="text-ink-3" />
                    <span className="flex-1 truncate">{o.owner || "Unknown owner"}</span>
                    <span className="text-xs text-ink-3 truncate">{o.cluster} {o.unit}</span>
                  </Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="hidden sm:flex items-center gap-3 px-4 h-9 border-t border-line text-xs text-ink-3">
            <span className="inline-flex items-center gap-1"><CornerDownLeft size={12} /> open</span>
            <span>↑↓ move</span><span>esc close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect}
      className="flex items-center gap-2.5 h-10 px-2.5 rounded-lg text-sm text-ink cursor-pointer data-[selected=true]:bg-surface-2">
      {children}
    </Command.Item>
  );
}
