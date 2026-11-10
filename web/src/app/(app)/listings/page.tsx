"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Copy, ImagePlus, Loader2, Megaphone, Plus, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { can } from "@/lib/access";
import { useStaff, staffName } from "@/lib/hooks";
import { BEDROOMS, PROPERTY_TYPES } from "@/lib/crm";
import { Badge, Button, Empty, Field, Input, ListSkeleton, PageHeader, SearchBox, Select, Sheet, Stat, StatusChip, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DataTable, FileField, FormError, Section, SetupNeeded, SIMPLE_TONE } from "@/components/company/kit";
import { requestApproval, uploadDoc, uploadListingPhoto, useRefresh, useRows } from "@/lib/company/data";
import { LISTING_STATUS, PORTALS, expiryState, listingBlockers, num, type Listing } from "@/lib/company/calc";
import { aed, fmtDate, shortAED, todayDubai } from "@/lib/format";

export default function ListingsPage() {
  return <Suspense><Listings /></Suspense>;
}

const blank = (email: string) => ({ owner_id: null as number | null, owner_name: "", community: "", cluster: "", unit: "", purpose: "sale", property_type: "Villa", bedrooms: "", bathrooms: "", bua_sqft: "", plot_sqft: "",
  price: "", title: "", description: "", agent_email: email, permit_no: "", permit_expiry: "", form_a_path: null as string | null, photos: [] as string[], portals: { property_finder: true, bayut: true, website: true } as Record<string, boolean> });

function Listings() {
  const { me } = useAuth();
  const staff = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const router = useRouter();
  const params = useSearchParams();
  const [ask, confirmNode] = useConfirm();
  const approver = can(me, "approve_listings");
  const list = useRows<Listing>("crm_listings", { order: "created_at" });
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [f, setF] = useState(blank(""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [feeds, setFeeds] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const today = todayDubai();

  const open = params.get("open") || (params.get("new") ? "new" : null);
  const setOpen = (id: string | null) => router.replace(id ? `/listings?${id === "new" ? "new=1" : `open=${id}`}` : "/listings", { scroll: false });
  const rows = list.data || [];
  const l = open && open !== "new" ? rows.find((x) => x.id === open) : undefined;
  const ownerParam = params.get("owner");

  useEffect(() => {
    if (!open) return;
    setErr(""); setBlockers(null);
    if (l) {
      setF({ owner_id: l.owner_id, owner_name: "", community: l.community || "", cluster: l.cluster || "", unit: l.unit || "", purpose: l.purpose, property_type: l.property_type || "", bedrooms: l.bedrooms || "",
        bathrooms: l.bathrooms != null ? String(l.bathrooms) : "", bua_sqft: l.bua_sqft != null ? String(l.bua_sqft) : "", plot_sqft: l.plot_sqft != null ? String(l.plot_sqft) : "", price: l.price != null ? String(l.price) : "",
        title: l.title || "", description: l.description || "", agent_email: l.agent_email, permit_no: l.permit_no || "", permit_expiry: l.permit_expiry || "", form_a_path: l.form_a_path, photos: l.photos || [], portals: l.portals || {} });
      db.rpc("crm_listing_blockers", { p_listing: l.id }).then(({ data, error }) => setBlockers(error ? null : ((data as string[]) || [])));
    } else if (open === "new") {
      setF(blank(me?.email || ""));
      if (ownerParam) fillFromOwner(Number(ownerParam));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, l?.id, l?.status]);

  /** A listing starts from an owner's unit: the unit's details come from the owners database. */
  async function fillFromOwner(id: number) {
    const o = await db.from("owners").select("id,owner,community,cluster,unit").eq("id", id).maybeSingle();
    if (!o.data) return;
    const od = o.data;
    const d = await db.from("unit_details").select("property_type,bedrooms,bua_sqft,plot_sqft").eq("community", od.community).eq("cluster", od.cluster).eq("unit", od.unit).maybeSingle();
    setF((v) => ({ ...v, owner_id: od.id, owner_name: od.owner || "", community: od.community || "", cluster: od.cluster || "", unit: od.unit || "",
      property_type: d.data?.property_type || v.property_type, bedrooms: d.data?.bedrooms ? (/^\d+$/.test(String(d.data.bedrooms)) ? `${d.data.bedrooms}BR` : String(d.data.bedrooms)) : v.bedrooms,
      bua_sqft: d.data?.bua_sqft ? String(d.data.bua_sqft) : v.bua_sqft, plot_sqft: d.data?.plot_sqft ? String(d.data.plot_sqft) : v.plot_sqft }));
  }
  async function findOwner() {
    if (!f.unit.trim()) return toast("Type the unit first");
    let query = db.from("owners").select("id").eq("unit", f.unit.trim()).limit(2);
    if (f.community.trim()) query = query.ilike("community", f.community.trim());
    if (f.cluster.trim()) query = query.ilike("cluster", f.cluster.trim());
    const r = await query;
    if (!r.data?.length) return toast("No owner found for this unit");
    if (r.data.length > 1) return toast("More than one match: add the community and cluster");
    await fillFromOwner(r.data[0].id); toast("Owner linked");
  }

  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const mine = !l || [l.agent_email.toLowerCase(), l.created_by.toLowerCase()].includes(me?.email || "");
  const editable = !l || approver || (mine && l.status !== "live");
  const local = listingBlockers({ permit_no: f.permit_no, permit_expiry: f.permit_expiry || null, form_a_path: f.form_a_path, price: num(f.price) }, "9999-12-31", today);

  async function save(next?: "pending") {
    if (!me) return null;
    if (!f.community.trim() && !f.unit.trim()) { setErr("Enter the property (community and unit)."); return null; }
    if (next === "pending" && local.length) { setErr(`Before it can go for approval: ${local.join("; ")}.`); return null; }
    setBusy(true); setErr("");
    const body = { owner_id: f.owner_id, community: f.community.trim() || null, cluster: f.cluster.trim() || null, unit: f.unit.trim() || null, purpose: f.purpose, property_type: f.property_type || null, bedrooms: f.bedrooms || null,
      bathrooms: f.bathrooms ? num(f.bathrooms) : null, bua_sqft: f.bua_sqft ? num(f.bua_sqft) : null, plot_sqft: f.plot_sqft ? num(f.plot_sqft) : null, price: f.price ? num(f.price) : null, title: f.title.trim() || null,
      description: f.description.trim() || null, agent_email: (f.agent_email || me.email).toLowerCase(), permit_no: f.permit_no.trim() || null, permit_expiry: f.permit_expiry || null, form_a_path: f.form_a_path, photos: f.photos, portals: f.portals,
      ...(next ? { status: next } : {}) };
    const r = l ? await db.from("crm_listings").update(body).eq("id", l.id).select("id,ref").single() : await db.from("crm_listings").insert({ ...body, status: next || "draft" }).select("id,ref").single();
    if (r.error) { setBusy(false); setErr(r.error.message); return null; }
    if (next === "pending") {
      const b = await db.rpc("crm_listing_blockers", { p_listing: r.data.id });
      const miss = (b.data as string[] | null) || [];
      if (!b.error && miss.length) {
        await db.from("crm_listings").update({ status: "draft" }).eq("id", r.data.id);
        setBusy(false); refresh(); setErr(`Saved as a draft. Before it can go live: ${miss.join("; ")}.`); if (!l) setOpen(r.data.id); return null;
      }
      try {
        await requestApproval({ kind: "listing", ref_table: "crm_listings", ref_id: r.data.id, amount: body.price, title: `Listing ${r.data.ref} · ${[body.community, body.cluster, body.unit].filter(Boolean).join(" ")}`,
          summary: `${body.purpose === "rent" ? "For rent" : "For sale"} · ${[body.bedrooms, body.property_type].filter(Boolean).join(" ")}\nTrakheesi ${body.permit_no}, valid to ${fmtDate(body.permit_expiry)}\nAgent: ${staffName(staff.data, body.agent_email)}` });
      } catch (x) { setBusy(false); setErr((x as Error).message); return null; }
    }
    setBusy(false); toast(next ? "Sent for approval" : "Saved"); refresh();
    if (!l) setOpen(r.data.id);
    return r.data.id as string;
  }
  async function decide(approve: boolean) {
    if (!l) return;
    const a = await db.from("crm_approvals").select("id").eq("ref_table", "crm_listings").eq("ref_id", l.id).eq("status", "pending").maybeSingle();
    if (!a.data) return toast("No approval request found. Open Approvals.");
    const r = await db.rpc("crm_decide_approval", { p_id: a.data.id, p_approve: approve, p_note: null });
    if (r.error) return toast(r.error.message);
    toast(approve ? "Listing is live" : "Sent back to the agent"); refresh();
  }
  async function setStatusTo(s: "unpublished" | "sold" | "rented" | "draft") {
    if (!l) return;
    const label = { unpublished: "Unpublish this listing?", sold: "Mark as sold by us?", rented: "Mark as rented by us?", draft: "Move back to draft?" }[s];
    if (!(await ask({ title: label, hint: s === "sold" || s === "rented" ? "It comes off the portals and the owner's history shows it." : "It comes off the portals at their next update.", yes: "Yes" }))) return;
    const r = await db.from("crm_listings").update({ status: s }).eq("id", l.id);
    if (r.error) toast(r.error.message); else { toast("Updated"); refresh(); }
  }
  async function addPhotos(files: FileList) {
    setBusy(true);
    try { const urls: string[] = []; for (const file of [...files].slice(0, 20)) urls.push(await uploadListingPhoto(file)); setF((v) => ({ ...v, photos: [...v.photos, ...urls] })); }
    catch (x) { toast((x as Error).message); }
    setBusy(false);
  }

  const shown = rows.filter((x) => (!status || x.status === status) && (!q || `${x.ref} ${x.community || ""} ${x.cluster || ""} ${x.unit || ""} ${x.title || ""}`.toLowerCase().includes(q.toLowerCase())));
  const counts = rows.reduce<Record<string, number>>((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {});
  const live = rows.filter((x) => x.status === "live");
  const expiring = live.filter((x) => { const s = expiryState(x.permit_expiry, today); return s.tone === "warn" || s.tone === "bad"; });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  if (list.isLoading) return <><PageHeader title="Listings" /><ListSkeleton /></>;
  if (list.data === null) return <><PageHeader title="Listings" /><SetupNeeded what="Listings" /></>;

  return (
    <div className="animate-in">
      <PageHeader title="Listings" subtitle="Adverts from owners' units, their Trakheesi permits and the portal feeds"
        actions={<>{me?.isAdmin && <Button onClick={() => setFeeds(true)}>Portal feeds</Button>}<Button variant="primary" onClick={() => setOpen("new")}><Plus size={16} /> New listing</Button></>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Live" value={String(live.length)} tone="good" />
        <Stat label="Waiting for approval" value={String(counts.pending || 0)} tone={counts.pending ? "warn" : undefined} />
        <Stat label="Permits expiring in 30 days" value={String(expiring.length)} tone={expiring.length ? "warn" : undefined} />
        <Stat label="Sold or rented by us" value={String((counts.sold || 0) + (counts.rented || 0))} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search reference, community or unit" />
        <div className="flex gap-1.5 overflow-x-auto">
          <StatusChip status="All" label="All" n={rows.length} active={!status} onClick={() => setStatus("")} />
          {Object.entries(LISTING_STATUS).filter(([k]) => counts[k]).map(([k, label]) => <StatusChip key={k} status={label} n={counts[k]} active={status === k} onClick={() => setStatus(status === k ? "" : k)} />)}
        </div>
      </div>
      <DataTable rows={shown} onRow={(x) => setOpen(x.id)} empty={<Empty icon={<Megaphone size={28} />} title={rows.length ? "No listings match" : "No listings yet"} hint={rows.length ? undefined : "Create a listing from an owner's unit. It goes live after the permit, Form A and approval checks."} />} cols={[
        { h: "Ref", cell: (x) => <span className="num font-medium">{x.ref}</span> },
        { h: "Property", cell: (x) => <div className="min-w-40"><div className="font-medium">{[x.community, x.cluster, x.unit].filter(Boolean).join(" · ")}</div><div className="text-xs text-ink-3">{[x.bedrooms, x.property_type, x.purpose === "rent" ? "for rent" : "for sale"].filter(Boolean).join(" · ")}</div></div> },
        { h: "Price", right: true, cell: (x) => (x.price ? `AED ${shortAED(x.price)}` : "—") },
        { h: "Agent", cell: (x) => <span className="text-ink-2 whitespace-nowrap">{staffName(staff.data, x.agent_email)}</span> },
        { h: "Trakheesi", cell: (x) => { const s = expiryState(x.permit_expiry, today); return x.permit_no ? <span className="flex items-center gap-2 whitespace-nowrap"><span className="num text-ink-2">{x.permit_no}</span>{s.tone !== "good" && <Badge tone={s.tone}>{s.text}</Badge>}</span> : <span className="text-ink-3">No permit</span>; } },
        { h: "Status", cell: (x) => <Badge tone={SIMPLE_TONE[x.status]}>{LISTING_STATUS[x.status]}</Badge> },
      ]} />

      <Sheet open={!!open} onClose={() => setOpen(null)} large
        title={l ? <span className="flex items-center gap-2 flex-wrap">{l.ref} <Badge tone={SIMPLE_TONE[l.status]}>{LISTING_STATUS[l.status]}</Badge></span> : "New listing"}
        footer={<>
          {l && l.status === "live" && (mine || approver) && <><Button variant="ghost" onClick={() => setStatusTo("unpublished")}>Unpublish</Button><Button onClick={() => setStatusTo(l.purpose === "rent" ? "rented" : "sold")}>{l.purpose === "rent" ? "Rented by us" : "Sold by us"}</Button></>}
          {l && l.status === "unpublished" && mine && <Button onClick={() => setStatusTo("draft")}>Back to draft</Button>}
          {l && l.status === "pending" && approver && (!mine || me?.isAdmin) && <><Button onClick={() => decide(false)}>Send back</Button><Button variant="primary" onClick={() => decide(true)}><Check size={15} /> Approve and go live</Button></>}
          {editable && (!l || ["draft", "unpublished", "live"].includes(l.status)) && <Button onClick={() => save()} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>}
          {(!l || l.status === "draft") && <Button variant="primary" onClick={() => save("pending")} disabled={busy}>Send for approval</Button>}
        </>}>
        <div className="space-y-5">
          {l && blockers && blockers.length > 0 && ["draft", "pending"].includes(l.status) && (
            <div className="rounded-xl bg-warn-soft text-warn text-sm p-3"><div className="flex gap-2 font-medium"><AlertTriangle size={16} className="shrink-0 mt-0.5" />Before this can go live</div><ul className="mt-1 ml-6 list-disc">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
          )}
          <Section title="Property" action={editable ? <button type="button" onClick={findOwner} className="text-[13px] font-medium text-accent-text">{f.owner_id ? "Owner linked ✓" : "Link owner from the database"}</button> : undefined}>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Community"><Input value={f.community} onChange={set("community")} disabled={!editable} /></Field>
              <Field label="Cluster"><Input value={f.cluster} onChange={set("cluster")} disabled={!editable} /></Field>
              <Field label="Unit"><Input value={f.unit} onChange={set("unit")} disabled={!editable} /></Field>
              <Field label="For"><Select value={f.purpose} onChange={set("purpose")} disabled={!editable}><option value="sale">Sale</option><option value="rent">Rent</option></Select></Field>
              <Field label="Type"><Select value={f.property_type} onChange={set("property_type")} disabled={!editable}><option value="">—</option>{PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Bedrooms"><Select value={f.bedrooms} onChange={set("bedrooms")} disabled={!editable}><option value="">—</option>{f.bedrooms && !BEDROOMS.includes(f.bedrooms) && <option>{f.bedrooms}</option>}{BEDROOMS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Bathrooms"><Input inputMode="decimal" value={f.bathrooms} onChange={set("bathrooms")} disabled={!editable} /></Field>
              <Field label="Built-up area, sq ft"><Input inputMode="decimal" value={f.bua_sqft} onChange={set("bua_sqft")} disabled={!editable} /></Field>
              <Field label="Plot, sq ft"><Input inputMode="decimal" value={f.plot_sqft} onChange={set("plot_sqft")} disabled={!editable} /></Field>
              <Field label={f.purpose === "rent" ? "Yearly rent, AED" : "Price, AED"}><Input inputMode="decimal" value={f.price} onChange={set("price")} disabled={!editable} /></Field>
              <Field label="Agent" className="sm:col-span-2"><Select value={f.agent_email} onChange={set("agent_email")} disabled={!editable || !(approver || me?.role === "team_leader")}>{f.agent_email && !(staff.data || []).some((u) => u.email.toLowerCase() === f.agent_email) && <option value={f.agent_email}>{f.agent_email}</option>}{(staff.data || []).map((u) => <option key={u.email} value={u.email.toLowerCase()}>{u.name || u.email}</option>)}</Select></Field>
            </div>
            {f.owner_name && <div className="mt-2 text-xs text-ink-3">Owner: {f.owner_name}</div>}
          </Section>
          <Section title="Advert">
            <div className="space-y-3">
              <Field label="Title"><Input value={f.title} onChange={set("title")} disabled={!editable} maxLength={200} placeholder="e.g. Corner 4BR | Single row | Close to pool" /></Field>
              <Field label="Description"><Textarea rows={5} value={f.description} onChange={set("description")} disabled={!editable} /></Field>
              <div>
                <div className="flex flex-wrap gap-2">
                  {f.photos.map((u) => (
                    <div key={u} className="relative size-20 rounded-xl overflow-hidden border border-line bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="size-full object-cover" />
                      {editable && <button aria-label="Remove photo" onClick={() => setF((v) => ({ ...v, photos: v.photos.filter((p) => p !== u) }))} className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-0.5"><X size={12} /></button>}
                    </div>
                  ))}
                  {editable && <button type="button" onClick={() => photoRef.current?.click()} className="size-20 rounded-xl border border-dashed border-line-strong text-ink-3 hover:text-ink grid place-items-center">{busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}</button>}
                </div>
                <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ""; }} />
              </div>
            </div>
          </Section>
          <Section title="Permit and Form A">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Trakheesi permit number"><Input value={f.permit_no} onChange={set("permit_no")} disabled={!editable} /></Field>
              <Field label="Permit valid to"><Input type="date" value={f.permit_expiry} onChange={set("permit_expiry")} disabled={!editable} /></Field>
              <Field label="Signed Form A"><FileField path={f.form_a_path} disabled={!editable} label="Upload Form A" onPick={async (file) => { const p = await uploadDoc("listings", file); setF((v) => ({ ...v, form_a_path: p })); }} /></Field>
            </div>
            <div className="mt-2 text-xs text-ink-3">A live listing comes off the portals by itself the day its permit expires.</div>
          </Section>
          <Section title="Publish on">
            <div className="flex flex-wrap gap-4">
              {Object.entries(PORTALS).map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)]" disabled={!editable} checked={f.portals[k] !== false} onChange={(e) => setF((v) => ({ ...v, portals: { ...v.portals, [k]: e.target.checked } }))} />{label}</label>)}
            </div>
          </Section>
          <FormError>{err}</FormError>
        </div>
      </Sheet>

      <Sheet open={feeds} onClose={() => setFeeds(false)} title="Portal feeds">
        <div className="text-sm text-ink-2 mb-4">Give each portal its link once. They read it on their own schedule and show only listings that are live with a Trakheesi permit in date. Each portal must switch feed access on for your account first.</div>
        {[["Property Finder (XML)", "property-finder"], ["Bayut / Dubizzle (XML)", "bayut"], ["Your website (JSON)", "website"]].map(([label, slug]) => (
          <div key={slug} className="mb-3">
            <div className="text-xs font-medium text-ink-2 mb-1">{label}</div>
            <div className="flex gap-2"><Input readOnly value={`${origin}/api/feeds/${slug}`} onFocus={(e) => e.target.select()} />
              <Button onClick={async () => { try { await navigator.clipboard.writeText(`${origin}/api/feeds/${slug}`); toast("Copied"); } catch { toast("Copy failed"); } }}><Copy size={15} /></Button></div>
          </div>
        ))}
        <div className="text-xs text-ink-3">{live.length} listing{live.length === 1 ? "" : "s"} live now. Sale price in AED: {aed(live.filter((x) => x.purpose === "sale").reduce((s, x) => s + num(x.price), 0))} in total.</div>
      </Sheet>
      {confirmNode}
    </div>
  );
}
