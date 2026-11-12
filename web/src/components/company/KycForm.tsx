"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { FileField, FormError } from "./kit";
import { isCompliance, uploadDoc, useRefresh } from "@/lib/company/data";
import { fmtDateTime } from "@/lib/format";
import { kycMissing } from "@/lib/company/calc";

export type Kyc = {
  id: string; deal_id: string; party: string; party_no?: number; full_name: string | null; nationality: string | null; id_type: string | null; id_number: string | null;
  id_expiry: string | null; id_file: string | null; source_of_funds: string | null; sanctions_checked: boolean; sanctions_note: string | null;
  status: "pending" | "complete"; completed_by: string | null; completed_at: string | null;
};
const LABEL: Record<string, string> = { buyer: "Buyer", seller: "Seller", tenant: "Tenant", landlord: "Landlord" };
export const partyLabel = (p: string) => LABEL[p] || p;
const noOf = (k: Kyc) => k.party_no ?? 1;

export { kycMissing };

/** Every KYC of a deal, one form per person, with "Add second buyer" while the deal can still be edited. */
export function KycParties({ dealId, need, rows, canEdit, open }: { dealId: string; need: string[]; rows: Kyc[]; canEdit: boolean; open: boolean }) {
  const { me } = useAuth();
  const toast = useToast();
  const refresh = useRefresh();
  const [adding, setAdding] = useState("");
  const canAdd = open && (canEdit || isCompliance(me));
  async function add(party: string, no: number) {
    setAdding(party);
    const r = await db.from("crm_kyc").insert({ deal_id: dealId, party, party_no: no });
    setAdding("");
    if (r.error) toast(r.error.message); else refresh();
  }
  if (!need.length) return <div className="text-sm text-ink-3">This type of deal needs no KYC.</div>;
  return (
    <>
      {need.map((p) => {
        const mine = rows.filter((k) => k.party === p).sort((a, b) => noOf(a) - noOf(b));
        const next = mine.length ? Math.max(...mine.map(noOf)) + 1 : 2;
        return (
          <div key={p} className="space-y-3">
            {mine.length ? mine.map((k) => <KycForm key={k.id} dealId={dealId} party={p} partyNo={noOf(k)} numbered={mine.length > 1} row={k} canEdit={canEdit} />)
              : <KycForm dealId={dealId} party={p} partyNo={1} numbered={false} row={undefined} canEdit={canEdit} />}
            {canAdd && mine.length > 0 && next <= 4 && (
              <Button size="sm" onClick={() => add(p, next)} disabled={!!adding}>
                {adding === p ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add {next === 2 ? "second" : next === 3 ? "third" : "fourth"} {partyLabel(p).toLowerCase()}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** One person's KYC. The agent fills it in; only the compliance officer can mark it complete. */
export function KycForm({ row, dealId, party, partyNo = 1, numbered = false, canEdit }: { row: Kyc | undefined; dealId: string; party: string; partyNo?: number; numbered?: boolean; canEdit: boolean }) {
  const { me } = useAuth();
  const toast = useToast();
  const refresh = useRefresh();
  const officer = isCompliance(me);
  const blank = { full_name: "", nationality: "", id_type: "Emirates ID", id_number: "", id_expiry: "", id_file: null as string | null, source_of_funds: "", sanctions_checked: false, sanctions_note: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    setF(row ? { full_name: row.full_name || "", nationality: row.nationality || "", id_type: row.id_type || "Emirates ID", id_number: row.id_number || "", id_expiry: row.id_expiry || "",
      id_file: row.id_file, source_of_funds: row.source_of_funds || "", sanctions_checked: row.sanctions_checked, sanctions_note: row.sanctions_note || "" } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status, row?.id_file]);
  const done = row?.status === "complete";
  const editable = !done && (canEdit || officer);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function save(complete: boolean, patch: Partial<typeof blank> = {}) {
    const v = { ...f, ...patch };
    if (complete && (!v.full_name.trim() || !v.id_number.trim() || !v.id_file || !v.source_of_funds.trim() || !v.sanctions_checked)) {
      setErr("To complete KYC: full name, ID number, ID copy, source of funds and the sanctions check are all needed."); return;
    }
    setBusy(true); setErr("");
    const body = {
      full_name: v.full_name.trim() || null, nationality: v.nationality.trim() || null, id_type: v.id_type, id_number: v.id_number.trim() || null, id_expiry: v.id_expiry || null,
      id_file: v.id_file, source_of_funds: v.source_of_funds.trim() || null,
      // Only the compliance officer records the sanctions check.
      ...(officer ? { sanctions_checked: v.sanctions_checked, sanctions_note: v.sanctions_note.trim() || null } : {}),
      status: complete ? "complete" : "pending",
    };
    const r = row ? await db.from("crm_kyc").update(body).eq("id", row.id) : await db.from("crm_kyc").insert({ ...body, deal_id: dealId, party, party_no: partyNo });
    setBusy(false);
    if (r.error) { setErr(r.error.message); return; }
    toast(complete ? "KYC completed" : "Saved"); refresh();
  }

  async function remove() {
    if (!row || !window.confirm(`Remove ${partyLabel(party).toLowerCase()} ${partyNo} from this deal's KYC?`)) return;
    setBusy(true); setErr("");
    const r = await db.from("crm_kyc").delete().eq("id", row.id);
    setBusy(false);
    if (r.error) { setErr(r.error.message); return; }
    toast("Removed"); refresh();
  }

  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="font-medium text-ink">{partyLabel(party)}{numbered || partyNo > 1 ? ` ${partyNo}` : ""}</div>
        {done ? <Badge tone="good"><ShieldCheck size={12} /> Complete</Badge> : <Badge tone="warn">KYC pending</Badge>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Full name (as on ID)"><Input value={f.full_name} onChange={set("full_name")} disabled={!editable} /></Field>
        <Field label="Nationality"><Input value={f.nationality} onChange={set("nationality")} disabled={!editable} /></Field>
        <Field label="ID type"><Select value={f.id_type} onChange={set("id_type")} disabled={!editable}><option>Emirates ID</option><option>Passport</option><option>Trade licence</option></Select></Field>
        <Field label="ID number"><Input value={f.id_number} onChange={set("id_number")} disabled={!editable} /></Field>
        <Field label="ID expiry"><Input type="date" value={f.id_expiry} onChange={set("id_expiry")} disabled={!editable} /></Field>
        <Field label="ID copy">
          <FileField path={f.id_file} disabled={!editable} label="Upload ID copy" onPick={async (file) => {
            const p = await uploadDoc("kyc", file); setF((v) => ({ ...v, id_file: p })); await save(false, { id_file: p });
          }} />
        </Field>
        <Field label="Source of funds" className="sm:col-span-2"><Input value={f.source_of_funds} onChange={set("source_of_funds")} disabled={!editable} placeholder="e.g. salary savings, sale of a property, mortgage from Emirates NBD" /></Field>
      </div>
      <div className="mt-3 rounded-xl bg-surface-2 p-3">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={f.sanctions_checked} disabled={!officer || done}
            onChange={(e) => setF((v) => ({ ...v, sanctions_checked: e.target.checked }))} />
          <span>Sanctions lists checked (UAE Local Terrorist List and UN Consolidated List){!officer && <span className="block text-xs text-ink-3">Done by the compliance officer.</span>}</span>
        </label>
        {(officer || f.sanctions_note) && <Textarea className="mt-2" rows={2} value={f.sanctions_note} onChange={set("sanctions_note")} disabled={!officer || done} placeholder="Sanctions check note: where checked, date, result" />}
      </div>
      {done && <div className="mt-2 text-xs text-ink-3">Completed by {row?.completed_by} · {fmtDateTime(row?.completed_at)}</div>}
      <FormError>{err}</FormError>
      {editable && (
        <div className="mt-3 flex justify-end gap-2">
          {row && partyNo > 1 && <Button size="sm" variant="ghost" onClick={remove} disabled={busy}><Trash2 size={14} /> Remove</Button>}
          <Button size="sm" onClick={() => save(false)} disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />}Save</Button>
          {officer && <Button size="sm" variant="primary" onClick={() => save(true)} disabled={busy}><Check size={14} /> Mark complete</Button>}
        </div>
      )}
    </div>
  );
}
