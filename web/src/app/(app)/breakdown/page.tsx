"use client";

// Build a property price breakdown, save it (table crm_breakdowns, RLS decides who sees it) and send the client a
// read-only link on WhatsApp. Maths, link and PDF: lib/breakdown.ts. The page the client sees: components/breakdown.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Link2, Loader2, MessageCircle, MoreHorizontal, Plus, Share2, Trash2, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { loadScript } from "@/lib/tools";
import { useConfirm } from "@/components/Confirm";
import { Badge, Button, Card, Field, Input, PageHeader, Segmented, Textarea, Toast, buttonClass, cx } from "@/components/ui";
import { BreakdownDoc } from "@/components/breakdown/BreakdownDoc";
import { buildPdf, calc, encode, fromLink, mediaUrl, money, normalize, num, pdfName, saveBlob, type Breakdown, type FieldKey, type MediaKey } from "@/lib/breakdown";

const WA_KEY = "crm_breakdown_whatsapp";
const myWhatsapp = () => { try { return localStorage.getItem(WA_KEY) || ""; } catch { return ""; } };
type Lead = { name: string | null; phone: string | null };
type Cur = { id: string | null; owner_id: number | null; lead_id: string | null; lead: Lead | null; data: Breakdown };
const blank = (extra?: Partial<Cur> & { fields?: Record<string, unknown> }): Cur => ({ id: null, owner_id: extra?.owner_id ?? null, lead_id: extra?.lead_id ?? null, lead: extra?.lead ?? null, data: normalize({ whatsapp: myWhatsapp(), ...(extra?.fields || {}) }) });

const PROPERTY: [FieldKey, string, boolean?, string?][] = [
  ["title", "Main title", true, "e.g. 5-Bedroom Semi-Detached"], ["subtitle", "Subtitle", true, "e.g. Arabian Ranches 3"],
  ["project", "Project"], ["developer", "Developer"], ["area", "Area"], ["type", "Type"], ["bedrooms", "Bedrooms"], ["bathrooms", "Bathrooms"],
  ["size", "Size", true, "e.g. Plot 4,520 | BUA: 3,426 sqft"], ["floor", "Floor"], ["view", "View"], ["completion", "Completion"],
];
const UPLOADS: [MediaKey, string, string][] = [["floorPlans", "Floor plan", "Images or PDF"], ["clusterPlans", "Cluster plan", "Images or PDF"], ["pictures", "Photos", "Images"]];

const fmtAmount = (v: unknown) => { const n = num(v); return n ? Math.round(n).toLocaleString("en-US") : String(v || "").trim(); };
const digits = (v: unknown) => (String(v || "").match(/\d+/) || [""])[0];
const sqft = (v: number | null) => (v ? Math.round(v).toLocaleString("en-US") : "");
const titleFor = (beds: string, type: string | null) => [beds && `${beds}-Bedroom`, type].filter(Boolean).join(" ");
function parseBudget(v: unknown) {
  const m = String(v || "").replace(/,/g, "").match(/([\d.]+)\s*([mk])?/i);
  if (!m) return "";
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1);
  return n >= 10000 ? String(Math.round(n)) : "";
}

// ------------------------------------------------------------------ images: JPEG on white; plans keep more pixels so small print stays readable
function toJpeg(src: CanvasImageSource, w: number, h: number, maxSide: number, q: number) {
  const k = Math.min(1, maxSide / Math.max(w, h)), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Image could not be converted"))), "image/jpeg", q));
}
async function fileToJpegs(file: File, kind: MediaKey) {
  const plan = kind !== "pictures", max = plan ? 2800 : 2000, q = plan ? 0.92 : 0.86;
  if (file.type === "application/pdf") {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    const lib = (window as any).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise, out: { blob: Blob; name: string }[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      const page = await pdf.getPage(i), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, max / Math.max(base.width, base.height)) });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      out.push({ blob: await toJpeg(c, c.width, c.height, max, q), name: `${file.name} p${i}` });
    }
    return out;
  }
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image or PDF`);
  const bmp = await createImageBitmap(file);
  try { return [{ blob: await toJpeg(bmp, bmp.width, bmp.height, max, q), name: file.name }]; } finally { bmp.close?.(); }
}

export default function BreakdownPage() {
  return <Suspense><Page /></Suspense>;
}

function Page() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [cur, setCur] = useState<Cur>(() => blank());
  const [dirty, setDirty] = useState(false);
  const [show, setShow] = useState<"edit" | "preview">("edit");
  const [pop, setPop] = useState<"" | "saved" | "share" | "more">("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [uploading, setUploading] = useState<Partial<Record<MediaKey, string>>>({});
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [ask, confirmNode] = useConfirm();
  const popWrap = useRef<HTMLDivElement>(null);
  const prefilled = useRef("");

  useEffect(() => { setCur(blank()); }, []); // the saved WhatsApp number is only readable in the browser

  const saved = useQuery({ queryKey: ["breakdowns"], queryFn: async () => {
    const { data, error } = await db.from("crm_breakdowns").select("id,title,data,owner_id,lead_id,created_by,updated_at,leads(name,phone)").order("updated_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return (data || []) as any[];
  } });

  const load = useCallback((c: Cur, keepDirty = false) => { setCur({ ...c, data: { ...c.data, whatsapp: c.data.whatsapp || myWhatsapp() } }); setDirty(keepDirty); }, []);
  const guard = useCallback(async (question = "Discard the unsaved changes?") => !dirty || ask({ title: question, yes: "Discard", danger: true }), [dirty, ask]);

  // Started from an owner or a lead. Owner name and unit number stay in the CRM: the client page only gets location and size.
  useEffect(() => {
    const owner = params.get("owner"), lead = params.get("lead");
    const key = owner ? `o${owner}` : lead ? `l${lead}` : "";
    if (!key || prefilled.current === key) return;
    prefilled.current = key;
    (async () => {
      if (owner) {
        const { data: row } = await db.from("owners").select("id,community,cluster,unit").eq("id", owner).maybeSingle();
        if (!row) return;
        const { data: u } = await db.from("unit_details").select("property_type,bedrooms,bua_sqft,plot_sqft").match({ community: row.community, cluster: row.cluster, unit: row.unit }).maybeSingle();
        const beds = digits(u?.bedrooms), type = u?.property_type || "";
        const size = [u?.plot_sqft && `Plot ${sqft(u.plot_sqft)}`, u?.bua_sqft && `BUA: ${sqft(u.bua_sqft)}`].filter(Boolean).join(" | ");
        load(blank({ owner_id: row.id, fields: { title: titleFor(beds, type), subtitle: [row.cluster, row.community].filter(Boolean).join(", "), project: row.cluster || "", area: row.community || "", type, bedrooms: beds, size: size ? `${size} sqft` : "" } }));
      } else {
        const { data: l } = await db.from("leads").select("id,name,phone,project_inquired,bedroom,property_type,budget").eq("id", lead!).maybeSingle();
        if (!l) return;
        const beds = digits(l.bedroom), price = parseBudget(l.budget);
        load(blank({ lead_id: l.id, lead: { name: l.name, phone: l.phone }, fields: { title: titleFor(beds, l.property_type), subtitle: l.project_inquired || "", project: l.project_inquired || "", type: l.property_type || "", bedrooms: beds, unitPrice: price, paymentSeller: price } }));
      }
      router.replace("/breakdown", { scroll: false });
    })();
  }, [params, load, router]);

  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { if (!popWrap.current?.contains(e.target as Node)) setPop(""); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(""); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [pop]);

  const patch = useCallback((fn: (d: Breakdown) => Breakdown) => { setCur((c) => ({ ...c, data: fn(c.data) })); setDirty(true); }, []);
  function setField(k: FieldKey, v: string) {
    patch((d) => {
      const n = { ...d, [k]: v };
      if (k === "unitPrice" && (!d.paymentSeller || num(d.paymentSeller) === num(d.unitPrice))) n.paymentSeller = v;
      return n;
    });
    if (k === "whatsapp") { try { localStorage.setItem(WA_KEY, v); } catch {} }
  }
  const c = useMemo(() => calc(cur.data), [cur.data]);
  const clientLink = () => `${location.origin}/breakdown.html?d=${encode(cur.data)}`;

  async function save() {
    const title = (cur.data.title || "").trim() || [cur.data.bedrooms && `${cur.data.bedrooms}BR`, cur.data.type, cur.data.project].filter(Boolean).join(" ") || "Property breakdown";
    const payload = { title: title.slice(0, 200), data: normalize(cur.data), owner_id: cur.owner_id, lead_id: cur.lead_id, updated_at: new Date().toISOString() };
    setSaving(true);
    const res = cur.id ? await db.from("crm_breakdowns").update(payload).eq("id", cur.id).select("id").single() : await db.from("crm_breakdowns").insert(payload).select("id").single();
    setSaving(false);
    if (res.error) { setToast("Could not save: " + res.error.message); return; }
    setCur((x) => ({ ...x, id: res.data.id })); setDirty(false); setToast("Breakdown saved");
    qc.invalidateQueries({ queryKey: ["breakdowns"] });
  }
  async function del() {
    setPop("");
    if (!cur.id || !(await ask({ title: `Delete "${cur.data.title || "this breakdown"}"?`, yes: "Delete", danger: true }))) return;
    const { error } = await db.from("crm_breakdowns").delete().eq("id", cur.id);
    if (error) { setToast(error.message); return; }
    setToast("Breakdown deleted"); load(blank()); qc.invalidateQueries({ queryKey: ["breakdowns"] });
  }
  async function withPdf(handle: (b: Blob) => Promise<void> | void) {
    setPop(""); setPdfBusy(true);
    try { await handle(await buildPdf(cur.data)); } catch (e) { console.error(e); setToast("Could not make the PDF: " + ((e as Error).message || e)); }
    setPdfBusy(false);
  }
  // Phones (and Safari/Edge on desktop) can attach the file straight to WhatsApp; elsewhere it downloads.
  async function sharePdf(blob: Blob) {
    const file = new File([blob], pdfName(cur.data), { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    saveBlob(blob, pdfName(cur.data)); setToast("PDF downloaded. Attach it in WhatsApp");
  }
  function sendWhatsApp() {
    setPop("");
    const d = cur.data, first = String(cur.lead?.name || "").trim().split(/\s+/)[0];
    const what = [d.title || "the property", d.subtitle].filter(Boolean).join(" – ");
    const text = `Hi${first ? " " + first : ""}, please find the price breakdown for ${what}:\n${clientLink()}`;
    const to = String(cur.lead?.phone || "").replace(/\D/g, "");
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  async function copyLink() {
    setPop("");
    try { await navigator.clipboard.writeText(clientLink()); setToast("Client link copied"); } catch { setToast("Could not copy the link"); }
  }

  async function addFiles(kind: MediaKey, files: File[]) {
    if (!files.length) return;
    let added = 0; const failed: string[] = [];
    for (const f of files) {
      setUploading((u) => ({ ...u, [kind]: `Uploading ${f.name}…` }));
      try {
        for (const img of await fileToJpegs(f, kind)) {
          const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
          const { error } = await db.storage.from("breakdown-media").upload(path, img.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
          if (error) throw error;
          patch((d) => ({ ...d, [kind]: [...d[kind], { path, name: img.name }] }));
          added++;
        }
      } catch (e) { console.warn(e); failed.push(`${f.name}: ${(e as Error).message || e}`); }
    }
    setUploading((u) => ({ ...u, [kind]: "" }));
    if (failed.length) setToast("Some files could not be added: " + failed.join("; "));
    else if (added) setToast(added === 1 ? "Added" : `${added} images added`);
  }
  const move = (k: MediaKey, i: number, by: number) => patch((d) => { const l = [...d[k]]; [l[i], l[i + by]] = [l[i + by], l[i]]; return { ...d, [k]: l }; });
  const removeMedia = (k: MediaKey, i: number) => patch((d) => ({ ...d, [k]: d[k].filter((_, n) => n !== i) }));
  const inst = (i: number, key: "label" | "amount", v: string) => patch((d) => ({ ...d, installments: d.installments.map((x, n) => (n === i ? { ...x, [key]: v } : x)) }));

  function doImport() {
    try { load({ ...blank(), data: fromLink(importText) }, true); setImporting(false); setImportText(""); setToast("Imported. Press Save to keep it"); }
    catch { setToast("That link could not be read"); }
  }

  const list = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (saved.data || []).filter((s) => !q || [s.title, s.data?.subtitle, s.data?.project, s.leads?.name].join(" ").toLowerCase().includes(q));
  }, [saved.data, search]);

  const Item = ({ icon, title, hint, onClick, danger }: { icon: React.ReactNode; title: string; hint?: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick} className="w-full flex items-start gap-2.5 text-left rounded-xl px-3 py-2.5 hover:bg-surface-2 transition-colors">
      <span className={cx("mt-0.5 shrink-0", danger ? "text-bad" : "text-ink-3")}>{icon}</span>
      <span><span className={cx("block text-[13.5px] font-medium", danger ? "text-bad" : "text-ink")}>{title}</span>{hint && <span className="block text-xs text-ink-3 mt-0.5">{hint}</span>}</span>
    </button>
  );
  const fieldProps = (k: FieldKey) => ({ value: cur.data[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setField(k, e.target.value) });
  const panel = "absolute z-40 top-[calc(100%+8px)] rounded-2xl bg-surface border border-line shadow-pop p-1.5 animate-in max-sm:!fixed max-sm:!inset-x-4 max-sm:!top-56 max-sm:!w-auto";

  return (
    <div className="animate-in">
      <PageHeader title="Breakdown" subtitle={<Badge tone={dirty ? "warn" : cur.id ? "good" : "neutral"}>{dirty ? "Unsaved changes" : cur.id ? "Saved" : "New"}</Badge>} actions={
        <div ref={popWrap} className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Button onClick={() => setPop(pop === "saved" ? "" : "saved")}>Saved {saved.data?.length ? <b className="font-semibold">{saved.data.length}</b> : null}<ChevronDown size={14} /></Button>
            {pop === "saved" && (
              <div className={cx(panel, "left-0 w-[min(340px,calc(100vw-32px))]")}>
                <Input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search saved breakdowns…" className="mb-1.5" />
                <div className="max-h-[min(60vh,420px)] overflow-y-auto">
                  {saved.error ? <div className="p-3 text-sm text-bad">{(saved.error as Error).message}</div>
                   : list.length === 0 ? <div className="p-4 text-center text-[13px] text-ink-3">No saved breakdowns yet.</div>
                   : list.map((s) => {
                      const price = num(s.data?.unitPrice);
                      const meta = [s.data?.subtitle || s.data?.project, price ? money(price) : "", new Date(s.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })].filter(Boolean).join(" · ");
                      return (
                        <button key={s.id} onClick={async () => { if (!(await guard())) return; setPop(""); load({ id: s.id, owner_id: s.owner_id, lead_id: s.lead_id, lead: s.leads || null, data: normalize(s.data) }); }}
                          className={cx("w-full text-left rounded-xl px-3 py-2 transition-colors hover:bg-surface-2", s.id === cur.id && "bg-accent-soft")}>
                          <span className="block text-[13.5px] font-medium text-ink leading-snug">{s.title}</span>
                          <span className="block text-xs text-ink-3 mt-0.5">{meta}{s.leads?.name ? ` · ${s.leads.name}` : ""}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
          <Button onClick={async () => { if (await guard()) load(blank()); }}><Plus size={15} /> New</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 size={15} className="animate-spin" />}Save</Button>
          <div className="relative">
            <Button variant="primary" disabled={pdfBusy} onClick={() => setPop(pop === "share" ? "" : "share")}>{pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}{pdfBusy ? "Making PDF…" : "Share with client"}<ChevronDown size={14} /></Button>
            {pop === "share" && (
              <div className={cx(panel, "right-0 w-[min(290px,calc(100vw-32px))]")} role="menu">
                <Item icon={<MessageCircle size={16} />} title="Send link on WhatsApp" hint="Opens WhatsApp with the client link ready to send" onClick={sendWhatsApp} />
                <Item icon={<Share2 size={16} />} title="Send PDF" hint="Attach the PDF in WhatsApp, email… (downloads on a computer)" onClick={() => withPdf(sharePdf)} />
                <Item icon={<Download size={16} />} title="Download PDF" hint="High-quality A4 PDF" onClick={() => withPdf((b) => { saveBlob(b, pdfName(cur.data)); setToast("PDF downloaded"); })} />
                <Item icon={<Copy size={16} />} title="Copy client link" hint="Paste it anywhere" onClick={copyLink} />
                <Item icon={<ExternalLink size={16} />} title="Open client page" hint="See exactly what the client sees" onClick={() => { setPop(""); window.open(clientLink(), "_blank", "noopener"); }} />
              </div>
            )}
          </div>
          <div className="relative">
            <Button aria-label="More actions" className="w-9 !px-0" onClick={() => setPop(pop === "more" ? "" : "more")}><MoreHorizontal size={16} /></Button>
            {pop === "more" && (
              <div className={cx(panel, "right-0 w-[min(270px,calc(100vw-32px))]")} role="menu">
                <Item icon={<Link2 size={16} />} title="Import old link" hint="From the old breakdown generator" onClick={async () => { setPop(""); if (await guard()) setImporting(true); }} />
                {cur.id && <Item danger icon={<Trash2 size={16} />} title="Delete this breakdown" onClick={del} />}
              </div>
            )}
          </div>
        </div>
      } />

      <div className="xl:hidden mb-3"><Segmented value={show} onChange={setShow} options={[{ value: "edit", label: "Edit" }, { value: "preview", label: "Preview" }]} /></div>

      <div className="grid gap-4 xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] items-start">
        <div className={cx("space-y-3.5 min-w-0", show === "preview" && "hidden xl:block")}>
          {importing && (
            <Card className="p-4 animate-in">
              <Field label="Paste a breakdown link (from this CRM or the old breakdown generator)"><Input autoFocus value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="https://…" /></Field>
              <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setImporting(false)}>Cancel</Button><Button variant="primary" onClick={doImport} disabled={!importText.trim()}>Import</Button></div>
            </Card>
          )}
          {(cur.lead || cur.owner_id) && <div className="rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] font-medium text-ink">{cur.lead ? `For lead: ${cur.lead.name || "—"}${cur.lead.phone ? ` · ${cur.lead.phone}` : ""}` : "Started from an owner record"}</div>}

          <FormCard title="Property">
            <div className="grid grid-cols-2 gap-3">
              {PROPERTY.map(([k, label, wide, ph]) => <Field key={k} label={label} className={wide ? "col-span-2" : ""}><Input autoComplete="off" placeholder={ph} {...fieldProps(k)} /></Field>)}
            </div>
          </FormCard>

          <FormCard title="Price">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit price (AED)"><Input inputMode="numeric" placeholder="5700000" className="font-semibold" {...fieldProps("unitPrice")} onBlur={() => patch((d) => ({ ...d, unitPrice: d.unitPrice && fmtAmount(d.unitPrice), paymentSeller: d.paymentSeller && fmtAmount(d.paymentSeller) }))} /></Field>
              <Field label="Payment to seller (AED)"><Input inputMode="numeric" placeholder="Same as price" {...fieldProps("paymentSeller")} onBlur={() => patch((d) => ({ ...d, unitPrice: d.unitPrice && fmtAmount(d.unitPrice), paymentSeller: d.paymentSeller && fmtAmount(d.paymentSeller) }))} /></Field>
              <Field label="Brokerage %"><Input inputMode="decimal" placeholder="2" {...fieldProps("brokeragePercent")} /></Field>
            </div>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] num">
              {([["DLD fee (4%)", c.dldFee], ["Trustee office fee", c.trusteeFee], ["Title deed fee", c.titleDeed], ["Brokerage + 5% VAT", c.brokerageVat]] as const).map(([l, v]) => (
                <div key={l} className="contents"><dt className="text-ink-2">{l}</dt><dd className="text-right font-medium text-ink">{money(v)}</dd></div>
              ))}
              <dt className="mt-1 pt-2 border-t border-line font-semibold text-[14px] text-ink">Total on transfer</dt>
              <dd className="mt-1 pt-2 border-t border-line text-right font-semibold text-[14px] text-ink">{money(c.totalTransfer)}</dd>
            </dl>
          </FormCard>

          <FormCard title="Payment plan">
            <div className="space-y-1.5">
              {cur.data.installments.map((x, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_36px] gap-1.5 items-center">
                  <Input value={x.label} placeholder="e.g. 60% on completion" onChange={(e) => inst(i, "label", e.target.value)} />
                  <Input value={x.amount} placeholder="AED" inputMode="numeric" onChange={(e) => inst(i, "amount", e.target.value)} onBlur={(e) => inst(i, "amount", fmtAmount(e.target.value))} />
                  <button aria-label="Remove installment" className="grid place-items-center size-9 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2" onClick={() => patch((d) => ({ ...d, installments: d.installments.filter((_, n) => n !== i) }))}><X size={15} /></button>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => patch((d) => ({ ...d, installments: [...d.installments, { label: "", amount: "" }] }))}><Plus size={14} /> Add installment</Button>
            <p className="mt-2 text-xs text-ink-3">Only for off-plan resales still paying the developer. Leave empty for ready properties.</p>
          </FormCard>

          <FormCard title="Plans & photos">
            <div className="divide-y divide-line">
              {UPLOADS.map(([k, label, hint]) => (
                <div key={k} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div><div className="text-[13px] font-medium text-ink">{label}</div><div className="text-xs text-ink-3">{hint}</div></div>
                    <label className={buttonClass("secondary", "sm", "cursor-pointer")}><Plus size={14} /> Add
                      <input type="file" hidden multiple aria-label={`Add ${label.toLowerCase()}`} accept={k === "pictures" ? "image/*" : "image/*,application/pdf"} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addFiles(k, f); }} />
                    </label>
                  </div>
                  {cur.data[k].length > 0 && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
                      {cur.data[k].map((x, i) => (
                        <figure key={x.path} className="relative aspect-square rounded-lg overflow-hidden border border-line bg-white m-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mediaUrl(x.path)} alt={x.name} loading="lazy" className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 text-white">
                            <button aria-label="Move left" disabled={!i} className="p-1 disabled:opacity-30" onClick={() => move(k, i, -1)}><ChevronLeft size={13} /></button>
                            <button aria-label="Remove" className="p-1" onClick={() => removeMedia(k, i)}><X size={13} /></button>
                            <button aria-label="Move right" disabled={i === cur.data[k].length - 1} className="p-1 disabled:opacity-30" onClick={() => move(k, i, 1)}><ChevronRight size={13} /></button>
                          </div>
                        </figure>
                      ))}
                    </div>
                  )}
                  {uploading[k] && <p className="text-xs text-ink-3 mt-1.5">{uploading[k]}</p>}
                </div>
              ))}
            </div>
          </FormCard>

          <FormCard title="Notes & contact">
            <div className="grid gap-3">
              <Field label="Notes on the page"><Textarea rows={3} value={cur.data.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} placeholder="e.g. Ready to move, vacant on transfer" /></Field>
              <Field label="Your WhatsApp number (shown to the client)"><Input inputMode="tel" autoComplete="off" placeholder="9715…" {...fieldProps("whatsapp")} /></Field>
            </div>
          </FormCard>
        </div>

        <section aria-label="Client preview" className={cx("xl:sticky xl:top-20 xl:max-h-[calc(100dvh-110px)] overflow-auto rounded-[20px] bg-surface-2 border border-line p-0 xl:p-5 [container-type:inline-size] min-w-0", show === "edit" && "hidden xl:block")}>
          <BreakdownDoc data={cur.data} />
        </section>
      </div>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      {confirmNode}
    </div>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="p-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h3>{children}</Card>;
}

