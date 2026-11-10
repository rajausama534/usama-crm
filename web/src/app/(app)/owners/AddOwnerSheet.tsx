"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useOwnerStatuses } from "@/lib/hooks";
import { Button, Field, Input, Segmented, Select, Sheet } from "@/components/ui";
import { logOwnerActivity } from "@/lib/crm";

type Prop = { community: string; cluster: string; unit: string; status: string; data_source: string };
const BLANK = { owner: "", email: "", phone1: "", phone2: "", community: "", cluster: "", unit: "", status: "New", data_source: "" };
const blankProp = (): Prop => ({ community: "", cluster: "", unit: "", status: "New", data_source: "" });

/** Admins add an owner, and any more properties under the same owner and contact details. */
export function AddOwnerSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const { me } = useAuth();
  const ownerStatuses = useOwnerStatuses();
  const [tab, setTab] = useState<"details" | "properties">("details");
  const [form, setForm] = useState(BLANK);
  const [props, setProps] = useState<Prop[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setForm(BLANK); setProps([]); setTab("details"); setErr(""); } }, [open]);
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setP = (i: number, k: keyof Prop) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setProps((l) => l.map((p, n) => (n === i ? { ...p, [k]: e.target.value } : p)));

  async function save() {
    if (!me) return;
    if (!form.owner.trim()) { setErr("Enter the owner name."); setTab("details"); return; }
    if (!form.unit.trim()) { setErr("Enter the property unit number."); setTab("details"); return; }
    setBusy(true); setErr("");
    const t = (s: string) => s.trim();
    const payload = { owner: t(form.owner), email: t(form.email) || null, phone1: t(form.phone1), phone2: t(form.phone2), community: t(form.community), cluster: t(form.cluster), unit: t(form.unit), status: form.status, data_source: t(form.data_source) };
    const extra = props.map((p) => ({ owner: payload.owner, email: payload.email, phone1: payload.phone1, phone2: payload.phone2, community: t(p.community) || null, cluster: t(p.cluster) || null, unit: t(p.unit) || null, status: p.status || "New", data_source: t(p.data_source) || payload.data_source }))
      .filter((p) => p.community || p.cluster || p.unit);
    const { data, error } = await db.from("owners").insert([payload]).select().single();
    if (error) { setBusy(false); setErr(`Could not save owner: ${error.message}`); return; }
    if (extra.length) {
      const r = await db.from("owners").insert(extra);
      if (r.error) { setBusy(false); setErr(`Owner details were saved, but the additional properties could not be added: ${r.error.message}`); return; }
    }
    await logOwnerActivity(data.id, "Owner added", extra.length ? `Owner added and ${extra.length} additional ${extra.length === 1 ? "property" : "properties"} added` : "Owner added", me.email);
    setBusy(false);
    onSaved(data.id);
  }

  return (
    <Sheet open={open} onClose={onClose} wide title="Add owner" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Add owner</Button>
    </>}>
      <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "details", label: "Owner details" }, { value: "properties", label: `More properties${props.length ? ` (${props.length})` : ""}` }]} /></div>
      {tab === "details" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Owner name"><Input value={form.owner} onChange={set("owner")} autoFocus /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} placeholder="owner@example.com" /></Field>
          <Field label="Phone 1"><Input value={form.phone1} onChange={set("phone1")} /></Field>
          <Field label="Phone 2"><Input value={form.phone2} onChange={set("phone2")} /></Field>
          <Field label="Community"><Input value={form.community} onChange={set("community")} /></Field>
          <Field label="Cluster"><Input value={form.cluster} onChange={set("cluster")} /></Field>
          <Field label="Unit"><Input value={form.unit} onChange={set("unit")} /></Field>
          <Field label="Status"><Select value={form.status} onChange={set("status")}>{ownerStatuses.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Source" className="sm:col-span-2"><Input value={form.data_source} onChange={set("data_source")} /></Field>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">Create another unit under the same owner and contact details.</p>
          {props.map((p, i) => (
            <div key={i} className="relative rounded-2xl border border-line p-3 grid sm:grid-cols-2 gap-3">
              <Field label="Community"><Input value={p.community} onChange={setP(i, "community")} /></Field>
              <Field label="Cluster"><Input value={p.cluster} onChange={setP(i, "cluster")} /></Field>
              <Field label="Unit"><Input value={p.unit} onChange={setP(i, "unit")} /></Field>
              <Field label="Status"><Select value={p.status} onChange={setP(i, "status")}>{ownerStatuses.map((s) => <option key={s}>{s}</option>)}</Select></Field>
              <Field label="Source" className="sm:col-span-2"><Input value={p.data_source} onChange={setP(i, "data_source")} /></Field>
              <button aria-label="Remove property" className="absolute top-2 right-2 p-1 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2" onClick={() => setProps((l) => l.filter((_, n) => n !== i))}><X size={15} /></button>
            </div>
          ))}
          <Button onClick={() => setProps((l) => [...l, blankProp()])}><Plus size={15} /> Add property</Button>
        </div>
      )}
      {err && <div className="mt-3 text-sm text-bad">{err}</div>}
    </Sheet>
  );
}
