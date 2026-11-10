"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { OWNER_STATUSES } from "@/lib/crm";
import { Button, Input, Sheet, StatusBadge } from "@/components/ui";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/ContactKit";

/** Owners table columns. "owner" is always shown. */
export const OWNER_COLUMNS = [
  { k: "community", l: "Community" }, { k: "cluster", l: "Cluster" }, { k: "unit", l: "Unit" },
  { k: "owner", l: "Owner name", locked: true }, { k: "whatsapp", l: "WhatsApp" }, { k: "status", l: "Status" },
  { k: "remark", l: "Latest remark" }, { k: "last", l: "Last contacted" }, { k: "actions", l: "Actions" },
] as const;
export type OwnerCol = (typeof OWNER_COLUMNS)[number]["k"];

/** Hidden columns, saved per person on this device (as the old CRM did). */
export function useOwnerColumns() {
  const { me } = useAuth();
  const key = `crm_owner_cols_hidden_v1:${me?.email || ""}`;
  const [hidden, setHidden] = useState<Set<OwnerCol>>(new Set());
  useEffect(() => {
    try { setHidden(new Set(JSON.parse(localStorage.getItem(key) || "[]"))); } catch { setHidden(new Set()); }
  }, [key]);
  const save = (next: Set<OwnerCol>) => {
    setHidden(next);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch {}
  };
  return { show: (k: OwnerCol) => !hidden.has(k), hidden, save };
}

export function ColumnsSheet({ open, onClose, hidden, save }: { open: boolean; onClose: () => void; hidden: Set<OwnerCol>; save: (s: Set<OwnerCol>) => void }) {
  const flip = (k: OwnerCol) => { const n = new Set(hidden); if (n.has(k)) n.delete(k); else n.add(k); save(n); };
  return (
    <Sheet open={open} onClose={onClose} title="Manage columns" footer={<>
      <Button variant="ghost" onClick={() => save(new Set())}>Show all</Button>
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
      <div className="text-sm text-ink-2 mb-3">Choose which columns show in the owners table. Saved for you on this device.</div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {OWNER_COLUMNS.map((c) => (
          <li key={c.k}>
            <label className="flex items-center gap-3 px-3.5 py-2.5 text-sm text-ink cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]" disabled={"locked" in c && c.locked}
                checked={!hidden.has(c.k)} onChange={() => flip(c.k)} />
              {c.l}{"locked" in c && c.locked && <span className="text-xs text-ink-3">(always shown)</span>}
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Admin only: add or remove custom owner statuses (shared with everyone). The standard ones can't be removed. */
export function StatusesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [ask, confirmNode] = useConfirm();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const custom = useQuery({
    queryKey: ["owner-statuses-custom"],
    enabled: open,
    queryFn: async () => {
      const [list, used] = await Promise.all([
        db.from("crm_owner_statuses").select("name").order("sort_order").order("name"),
        db.rpc("crm_dashboard_stats"),
      ]);
      if (list.error) throw list.error;
      const counts = ((used.data as { owner_status?: Record<string, number> } | null)?.owner_status) || {};
      return (list.data || []).map((r) => ({ name: r.name as string, n: counts[r.name] || 0 }));
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["owner-statuses"] }); qc.invalidateQueries({ queryKey: ["owner-statuses-custom"] }); };

  async function add() {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n || !me) return;
    const all = [...OWNER_STATUSES, ...(custom.data || []).map((c) => c.name)];
    if (all.some((s) => s.toLowerCase() === n.toLowerCase())) { toast("That status already exists"); return; }
    setBusy(true);
    const { error } = await db.from("crm_owner_statuses").insert({ name: n, created_by: me.email });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setName(""); toast(); refresh();
  }
  async function remove(c: { name: string; n: number }) {
    const ok = await ask({
      title: `Remove the status "${c.name}"?`,
      hint: c.n ? `${c.n} owner(s) have it now. They keep it, but it won't be offered in the list any more.` : "No owner has it now.",
      yes: "Remove", danger: true,
    });
    if (!ok) return;
    const { error } = await db.from("crm_owner_statuses").delete().eq("name", c.name);
    if (error) { toast(error.message); return; }
    toast(); refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Manage owner statuses" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        <div>
          <div className="text-xs font-semibold text-ink-2 mb-1.5">Add a status</div>
          <div className="flex gap-2">
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wants valuation"
              onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button variant="primary" onClick={add} disabled={busy || !name.trim()}>{busy && <Loader2 size={15} className="animate-spin" />}Add</Button>
          </div>
          <div className="text-xs text-ink-3 mt-1.5">Everyone in the CRM sees the new status. Only you can add or remove them.</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-2 mb-1.5">Your statuses</div>
          {custom.isLoading ? <div className="text-sm text-ink-3">Loading…</div>
            : custom.error ? <div className="text-sm text-ink-3">Custom statuses are not switched on yet (database update pending).</div>
            : !custom.data?.length ? <div className="text-sm text-ink-3">None yet.</div>
            : <ul className="divide-y divide-line rounded-xl border border-line">
                {custom.data.map((c) => (
                  <li key={c.name} className="flex items-center gap-3 px-3.5 py-2">
                    <StatusBadge status={c.name} />
                    <span className="text-xs text-ink-3 num">{c.n} owner{c.n === 1 ? "" : "s"}</span>
                    <button onClick={() => remove(c)} className="ml-auto p-1.5 rounded-full text-ink-3 hover:text-bad hover:bg-surface-2" aria-label={`Remove ${c.name}`}><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>}
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-2 mb-1.5">Standard statuses (always there)</div>
          <div className="flex flex-wrap gap-1.5">{OWNER_STATUSES.map((s) => <StatusBadge key={s} status={s} />)}</div>
        </div>
      </div>
      {confirmNode}
    </Sheet>
  );
}
