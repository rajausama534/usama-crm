"use client";

// Shared reading/writing helpers for the company departments (deals, accounts, HR, listings).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { can, type Me } from "@/lib/access";
import { invoiceFromDeal, type CompanySettings, type Deal, type Developer } from "./calc";
import { todayDubai } from "@/lib/format";

/** True when the database update for these departments has not been applied yet. */
export const isMissing = (m?: string | null) => !!m && /relation|does not exist|schema cache|Could not find/i.test(m);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
/** Rows of one table (the person's own access applies). `null` = the table is not in the database yet. */
export function useRows<T>(table: string, o: { key?: unknown[]; select?: string; order?: string; asc?: boolean; filter?: (q: Q) => Q; enabled?: boolean; limit?: number } = {}) {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["co", table, ...(o.key || [])],
    enabled: !!me && o.enabled !== false,
    queryFn: async () => {
      let q: Q = db.from(table).select(o.select || "*");
      if (o.filter) q = o.filter(q);
      if (o.order) q = q.order(o.order, { ascending: !!o.asc });
      const { data, error } = await q.limit(o.limit || 2000);
      if (error) { if (isMissing(error.message)) return null; throw new Error(error.message); }
      return (data || []) as T[];
    },
  });
}

/** Refreshes every company list after a change (they are small). */
export function useRefresh() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["co"] }); qc.invalidateQueries({ queryKey: ["approvals"] }); };
}

export function useCompany() {
  const q = useRows<{ id: number; data: CompanySettings }>("crm_company_settings", { key: ["settings"] });
  return { ...q, settings: (q.data?.[0]?.data || { name: "Usama Real Estate" }) as CompanySettings };
}

export const isFinance = (me: Me | null) => !!me && (me.isAdmin || me.role === "accounts" || me.permissions.has("view_finance"));
export const isHr = (me: Me | null) => !!me && (me.isAdmin || me.role === "hr");
export const isCompliance = (me: Me | null) => can(me, "compliance");

/** Puts a request in the approvals inbox. If the same item is already waiting, nothing is added. */
export async function requestApproval(a: { kind: "deal" | "expense" | "advance" | "leave" | "listing"; ref_table: string; ref_id: string; title: string; summary?: string; amount?: number | null }) {
  const { error } = await db.from("crm_approvals").insert({ ...a, title: a.title.slice(0, 200), summary: a.summary?.slice(0, 2000) || null, amount: a.amount ?? null });
  if (error && error.code !== "23505") throw new Error(error.message);
}

/** After a deal is approved, issue its tax invoice once (Accounts only; quietly does nothing for others or if one exists). */
export async function autoInvoiceDeal(dealId: string): Promise<string | null> {
  const [d, inv, devs] = await Promise.all([
    db.from("crm_deals").select("*").eq("id", dealId).maybeSingle(),
    db.from("crm_invoices").select("id").eq("deal_id", dealId).neq("status", "cancelled").limit(1),
    db.from("crm_developers").select("id,name"),
  ]);
  const deal = d.data as Deal | null;
  if (!deal || inv.error || (inv.data || []).length || !["approved", "part_received", "received", "agents_paid"].includes(deal.status)) return null;
  if (!(num0(deal.commission) + num0(deal.seller_fee) > 0)) return null;
  const today = todayDubai();
  const r = await db.from("crm_invoices").insert({ ...invoiceFromDeal(deal, (devs.data || []) as Developer[], today), issue_date: today }).select("invoice_no").single();
  return r.error ? null : r.data.invoice_no;
}
const num0 = (n: unknown) => Number(n) || 0;

const BUCKET = "company-docs";
/** Saves a private file (ID copy, receipt, Form A, staff document). Returns its path. */
export async function uploadDoc(folder: "kyc" | "receipts" | "hr" | "cv" | "listings", file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("The file is larger than 10 MB.");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
/** Opens a private file in a new tab with a link that works for five minutes. */
export async function openDoc(path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not open the file.");
  window.open(data.signedUrl, "_blank", "noopener");
}
/** Public photo for a listing (portals need a public link). */
export async function uploadListingPhoto(file: File) {
  if (file.size > 8 * 1024 * 1024) throw new Error("The photo is larger than 8 MB.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from("listing-media").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return db.storage.from("listing-media").getPublicUrl(path).data.publicUrl;
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([type.startsWith("text/csv") ? "﻿" + text : text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
