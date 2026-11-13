"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Copy, ImagePlus, Loader2, Megaphone, Plus, Star, Trash2, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { can } from "@/lib/access";
import { useStaff, staffName } from "@/lib/hooks";
import { BEDROOMS, PROPERTY_TYPES } from "@/lib/crm";
import { Badge, Button, Card, Empty, Field, Input, ListSkeleton, PageHeader, SearchBox, Segmented, Select, Sheet, Stat, StatusChip, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DataTable, FormError, SetupNeeded, SIMPLE_TONE } from "@/components/company/kit";
import { requestApproval, uploadListingPhoto, useRefresh, useRows } from "@/lib/company/data";
import { LISTING_STATUS, PORTALS, expiryState, listingBlockers, num, type Listing } from "@/lib/company/calc";
import { aed, shortAED, todayDubai } from "@/lib/format";

export default function ListingsPage() {
  return <Suspense><Listings /></Suspense>;
}

/** Most photos one listing can carry. */
const MAX_PHOTOS = 10;

const blank = (email: string) => ({ owner_id: null as number | null, owner_name: "", community: "", cluster: "", unit: "", purpose: "sale", property_type: "Villa", bedrooms: "", bathrooms: "", bua_sqft: "", plot_sqft: "",
  price: "", title: "", description: "", agent_email: email, permit_no: "", photos: [] as string[], portals: { property_finder: true, bayut: true, website: true } as Record<string, boolean> });

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
        title: l.title || "", description: l.description || "", agent_email: l.agent_email, permit_no: l.permit_no || "", photos: l.photos || [], portals: l.portals || {} });
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
  const local = listingBlockers({ permit_no: f.permit_no, price: num(f.price) }, "9999-12-31", today);
  const canDelete = !!l && ["draft", "unpublished"].includes(l.status) && (mine || approver || !!me?.isAdmin);

  async function save(next?: "pending") {
    if (!me) return null;
    if (!f.community.trim() && !f.unit.trim()) { setErr("Enter the property (community and unit)."); return null; }
    if (next === "pending" && local.length) { setErr(`Before it can go for approval: ${local.join("; ")}.`); return null; }
    setBusy(true); setErr("");
    const body = { owner_id: f.owner_id, community: f.community.trim() || null, cluster: f.cluster.trim() || null, unit: f.unit.trim() || null, purpose: f.purpose, property_type: f.property_type || null, bedrooms: f.bedrooms || null,
      bathrooms: f.bathrooms ? num(f.bathrooms) : null, bua_sqft: f.bua_sqft ? num(f.bua_sqft) : null, plot_sqft: f.plot_sqft ? num(f.plot_sqft) : null, price: f.price ? num(f.price) : null, title: f.title.trim() || null,
      description: f.description.trim() || null, agent_email: (f.agent_email || me.email).toLowerCase(), permit_no: f.permit_no.trim() || null, photos: f.photos, portals: f.portals,
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
          summary: `${body.purpose === "rent" ? "For rent" : "For sale"} · ${[body.bedrooms, body.property_type].filter(Boolean).join(" ")}\nTrakheesi ${body.permit_no}\nAgent: ${staffName(staff.data, body.agent_email)}` });
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
    if (!(await ask({ title: label, hint: s === "sold" || s === "rented" ? "It comes off the portals and the owner's history shows it." : s === "unpublished" ? "It comes off Property Finder, Bayut and the website at their next update. It stays here as Unpublished: you can edit it, delete it or move it back to draft." : "You can edit it and send it for approval again.", yes: "Yes" }))) return;
    const r = await db.from("crm_listings").update({ status: s }).eq("id", l.id);
    if (r.error) toast(r.error.message); else { toast("Updated"); refresh(); }
  }
  async function remove() {
    if (!l) return;
    if (!(await ask({ title: `Delete listing ${l.ref}?`, hint: "It is removed from the CRM for good, with its details and photos list. This cannot be undone.", yes: "Delete listing", danger: true }))) return;
    setBusy(true);
    const r = await db.from("crm_listings").delete().eq("id", l.id).select("id");
    setBusy(false);
    if (r.error) return toast(r.error.message);
    if (!r.data?.length) return toast("This listing could not be deleted. Only drafts and unpublished listings can be.");
    toast(`Listing ${l.ref} deleted`); setOpen(null); refresh();
  }
  const [dragging, setDragging] = useState(false);
  async function addPhotos(files: FileList | File[]) {
    const room = MAX_PHOTOS - f.photos.length;
    const pick = [...files].filter((x) => /^image\/(jpeg|png|webp)$/.test(x.type));
    if (room <= 0) return toast(`A listing can have up to ${MAX_PHOTOS} photos. Remove one first.`);
    if (!pick.length) return toast("Choose JPG, PNG or WebP photos");
    if (pick.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} fit (up to ${MAX_PHOTOS}). The first ${room} were added.`);
    setBusy(true);
    try { const urls: string[] = []; for (const file of pick.slice(0, room)) urls.push(await uploadListingPhoto(file)); setF((v) => ({ ...v, photos: [...v.photos, ...urls].slice(0, Math.max(MAX_PHOTOS, v.photos.length)) })); }
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


  /** Add / edit a listing on its own full page (like the portals' own listing forms), not in a side panel. */
  function editor() {
    if (open !== "new" && !l) return <><PageHeader title="Listing" /><Empty icon={<Megaphone size={28} />} title="Listing not found" hint="It may have been deleted, or you don't have access to it." /><div className="mt-4"><Button onClick={() => setOpen(null)}><ArrowLeft size={15} /> Back to listings</Button></div></>;
    const dis = !editable;
    return (
      <div className="animate-in pb-28">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button onClick={() => setOpen(null)} className="p-2 -ml-2 rounded-full text-ink-2 hover:text-ink hover:bg-surface-2" aria-label="Back to listings"><ArrowLeft size={20} /></button>
          <h1 className="text-[26px] font-normal tracking-tight text-ink leading-tight">{l ? (l.title || l.ref) : "Add a listing"}</h1>
          {l && <span className="flex items-center gap-2">{l.title && <span className="num text-sm text-ink-3">{l.ref}</span>}<Badge tone={SIMPLE_TONE[l.status]}>{LISTING_STATUS[l.status]}</Badge></span>}
        </div>
        <div className="max-w-4xl mx-auto space-y-5">
          {l && blockers && blockers.length > 0 && ["draft", "pending"].includes(l.status) && (
            <div className="rounded-xl bg-warn-soft text-warn text-sm p-3"><div className="flex gap-2 font-medium"><AlertTriangle size={16} className="shrink-0 mt-0.5" />Before this can go live</div><ul className="mt-1 ml-6 list-disc">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
          )}
          {l?.status === "unpublished" && <div className="rounded-xl bg-surface-2 text-ink-2 text-sm p-3">Unpublished: it is off Property Finder, Bayut and the website. Move it back to draft to send it for approval again, or delete it.</div>}

          <Block title="Location" action={editable ? <button type="button" onClick={findOwner} className="text-[13px] font-medium text-accent-text">{f.owner_id ? "Owner linked ✓" : "Link owner from the database"}</button> : undefined}>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Community"><Input value={f.community} onChange={set("community")} disabled={dis} placeholder="e.g. Arabian Ranches 2" /></Field>
              <Field label="Cluster / building"><Input value={f.cluster} onChange={set("cluster")} disabled={dis} placeholder="e.g. Azalea" /></Field>
              <Field label="Unit"><Input value={f.unit} onChange={set("unit")} disabled={dis} /></Field>
            </div>
            {f.owner_name && <div className="mt-2 text-xs text-ink-3">Owner: {f.owner_name}</div>}
          </Block>

          <Block title="Property details">
            <div className="mb-4"><div className="text-xs font-medium text-ink-2 mb-1.5">Rent or sale</div>
              {dis ? <Badge>{f.purpose === "rent" ? "Rent" : "Sale"}</Badge> : <Segmented value={f.purpose as "sale" | "rent"} options={[{ value: "sale", label: "Sale" }, { value: "rent", label: "Rent" }]} onChange={(v) => setF((x) => ({ ...x, purpose: v }))} />}
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Property type"><Select value={f.property_type} onChange={set("property_type")} disabled={dis}><option value="">—</option>{PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Bedrooms"><Select value={f.bedrooms} onChange={set("bedrooms")} disabled={dis}><option value="">—</option>{f.bedrooms && !BEDROOMS.includes(f.bedrooms) && <option>{f.bedrooms}</option>}{BEDROOMS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Bathrooms"><Input inputMode="decimal" value={f.bathrooms} onChange={set("bathrooms")} disabled={dis} /></Field>
              <Field label="Built-up area, sq ft"><Input inputMode="decimal" value={f.bua_sqft} onChange={set("bua_sqft")} disabled={dis} /></Field>
              <Field label="Plot area, sq ft"><Input inputMode="decimal" value={f.plot_sqft} onChange={set("plot_sqft")} disabled={dis} /></Field>
            </div>
          </Block>

          <Block title="Price">
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label={f.purpose === "rent" ? "Yearly rent, AED" : "Price, AED"}><Input inputMode="decimal" value={f.price} onChange={set("price")} disabled={dis} /></Field>
              <Field label="Agent" className="sm:col-span-2"><Select value={f.agent_email} onChange={set("agent_email")} disabled={dis || !(approver || me?.role === "team_leader")}>{f.agent_email && !(staff.data || []).some((u) => u.email.toLowerCase() === f.agent_email) && <option value={f.agent_email}>{f.agent_email}</option>}{(staff.data || []).map((u) => <option key={u.email} value={u.email.toLowerCase()}>{u.name || u.email}</option>)}</Select></Field>
            </div>
            {num(f.price) > 0 && <div className="mt-2 text-xs text-ink-3">{aed(num(f.price))}{f.purpose === "rent" ? " a year" : ""}</div>}
          </Block>

          <Block title="Title and description">
            <div className="space-y-4">
              <Field label={`Title (${f.title.length}/200)`}><Input value={f.title} onChange={set("title")} disabled={dis} maxLength={200} placeholder="e.g. Corner 4BR | Single row | Close to pool" /></Field>
              <Field label="Description"><Textarea rows={9} value={f.description} onChange={set("description")} disabled={dis} maxLength={6000} /></Field>
            </div>
          </Block>

          <Block title={`Images (${f.photos.length}/${MAX_PHOTOS})`}>
            <div className={`rounded-2xl ${dragging ? "ring-2 ring-accent" : ""}`}
              onDragOver={(e) => { if (!dis) { e.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (!dis && e.dataTransfer.files.length) addPhotos(e.dataTransfer.files); }}>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                {f.photos.map((u, i) => (
                  <div key={u} className="relative aspect-[4/3] rounded-xl overflow-hidden border border-line bg-surface-2 group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="size-full object-cover" />
                    {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 text-white text-[11px] px-2 py-0.5">Cover</span>}
                    {!dis && <div className="absolute top-1.5 right-1.5 flex gap-1">
                      {i > 0 && <button type="button" title="Make cover photo" aria-label="Make cover photo" onClick={() => setF((v) => ({ ...v, photos: [u, ...v.photos.filter((p) => p !== u)] }))} className="rounded-full bg-black/60 text-white p-1"><Star size={12} /></button>}
                      <button type="button" aria-label="Remove photo" onClick={() => setF((v) => ({ ...v, photos: v.photos.filter((p) => p !== u) }))} className="rounded-full bg-black/60 text-white p-1"><X size={12} /></button>
                    </div>}
                  </div>
                ))}
                {!dis && f.photos.length < MAX_PHOTOS && (
                  <button type="button" onClick={() => photoRef.current?.click()} disabled={busy} className="aspect-[4/3] rounded-xl border border-dashed border-line-strong text-ink-3 hover:text-ink hover:bg-surface-2 flex flex-col items-center justify-center gap-1 text-xs">
                    {busy ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={22} />}{busy ? "Uploading…" : "Add photos"}
                  </button>
                )}
              </div>
              <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ""; }} />
            </div>
            <div className="mt-2 text-xs text-ink-3">Up to {MAX_PHOTOS} photos, JPG, PNG or WebP, 8 MB each. Drag them in or click Add photos. The first one is the cover; use the star to change it.</div>
            {f.photos.length > MAX_PHOTOS && <div className="mt-1 text-xs text-warn">This listing has {f.photos.length} photos from before the limit. Remove {f.photos.length - MAX_PHOTOS} to add new ones.</div>}
          </Block>

          <Block title="Trakheesi permit">
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Trakheesi permit number"><Input value={f.permit_no} onChange={set("permit_no")} disabled={dis} /></Field>
            </div>
            <div className="mt-2 text-xs text-ink-3">A Trakheesi permit is only issued on a signed Form A, so the permit number is all that is needed.</div>
          </Block>

          <Block title="Publish on">
            <div className="flex flex-wrap gap-5">
              {Object.entries(PORTALS).map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)] size-4" disabled={dis} checked={f.portals[k] !== false} onChange={(e) => setF((v) => ({ ...v, portals: { ...v.portals, [k]: e.target.checked } }))} />{label}</label>)}
            </div>
          </Block>
          <FormError>{err}</FormError>
        </div>

        <div className="fixed bottom-0 inset-x-0 lg:left-60 z-40 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-end gap-2">
            {canDelete && <Button variant="ghost" className="mr-auto !text-bad hover:!bg-bad/10" onClick={remove} disabled={busy}><Trash2 size={15} /> Delete listing</Button>}
            <Button variant="ghost" onClick={() => setOpen(null)}>{l ? "Close" : "Cancel"}</Button>
            {l && l.status === "live" && (mine || approver) && <><Button onClick={() => setStatusTo("unpublished")}>Unpublish</Button><Button onClick={() => setStatusTo(l.purpose === "rent" ? "rented" : "sold")}>{l.purpose === "rent" ? "Rented by us" : "Sold by us"}</Button></>}
            {l && l.status === "unpublished" && (mine || approver) && <Button onClick={() => setStatusTo("draft")}>Back to draft</Button>}
            {l && l.status === "pending" && approver && (!mine || me?.isAdmin) && <><Button onClick={() => decide(false)}>Send back</Button><Button variant="primary" onClick={() => decide(true)}><Check size={15} /> Approve and go live</Button></>}
            {editable && (!l || ["draft", "unpublished", "live"].includes(l.status)) && <Button onClick={() => save()} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>}
            {(!l || l.status === "draft") && <Button variant="primary" onClick={() => save("pending")} disabled={busy}>Send for approval</Button>}
          </div>
        </div>
        {confirmNode}
      </div>
    );
  }

  if (open) return editor();

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
      <DataTable rows={shown} onRow={(x) => setOpen(x.id)} empty={<Empty icon={<Megaphone size={28} />} title={rows.length ? "No listings match" : "No listings yet"} hint={rows.length ? undefined : "Create a listing from an owner's unit. It goes live after the Trakheesi permit and approval checks."} />} cols={[
        { h: "Ref", cell: (x) => <span className="num font-medium">{x.ref}</span> },
        { h: "Property", cell: (x) => <div className="min-w-40"><div className="font-medium">{[x.community, x.cluster, x.unit].filter(Boolean).join(" · ")}</div><div className="text-xs text-ink-3">{[x.bedrooms, x.property_type, x.purpose === "rent" ? "for rent" : "for sale"].filter(Boolean).join(" · ")}</div></div> },
        { h: "Price", right: true, cell: (x) => (x.price ? `AED ${shortAED(x.price)}` : "—") },
        { h: "Agent", cell: (x) => <span className="text-ink-2 whitespace-nowrap">{staffName(staff.data, x.agent_email)}</span> },
        { h: "Trakheesi", cell: (x) => { const s = expiryState(x.permit_expiry, today); return x.permit_no ? <span className="flex items-center gap-2 whitespace-nowrap"><span className="num text-ink-2">{x.permit_no}</span>{s.tone !== "good" && <Badge tone={s.tone}>{s.text}</Badge>}</span> : <span className="text-ink-3">No permit</span>; } },
        { h: "Status", cell: (x) => <Badge tone={SIMPLE_TONE[x.status]}>{LISTING_STATUS[x.status]}</Badge> },
      ]} />

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

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
