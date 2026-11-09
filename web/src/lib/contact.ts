// Contacting owners and leads — same rules and wording as the old CRM (index.html, crm-enhancements-core.js,
// lead-contacted-hotfix.js) so agents see identical messages and history entries.
import { db } from "@/lib/supabase";
import { todayDubai } from "@/lib/format";

export const WHATSAPP_TEMPLATE_KEY = "usama_whatsapp_template_v1";
/** Owner ids ticked on the Owners page, picked up by WhatsApp Broadcast. */
export const BROADCAST_IDS_KEY = "crm_broadcast_ids";
export type WaTemplate = { greeting: string; agentName: string; title: string; company: string; message: string };

export const DEFAULT_TEMPLATE: WaTemplate = {
  greeting: "Hello",
  agentName: "Usama",
  title: "Head of Sales",
  company: "Hawaii Real Estate",
  message: "Would you consider selling if you receive a strong offer?",
};

export function getTemplate(fallbackName?: string, isAdmin?: boolean): WaTemplate {
  const fallback: WaTemplate = {
    ...DEFAULT_TEMPLATE,
    agentName: fallbackName || DEFAULT_TEMPLATE.agentName,
    title: isAdmin ? DEFAULT_TEMPLATE.title : "",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(WHATSAPP_TEMPLATE_KEY) || "null");
    if (!saved) return fallback;
    const company = (c: string) => (!c || /\bbfg\b/i.test(c) ? DEFAULT_TEMPLATE.company : c);
    return {
      greeting: (saved.greeting || fallback.greeting).trim(),
      agentName: (saved.agentName || fallback.agentName).trim(),
      title: (saved.title ?? fallback.title).trim(),
      company: company(saved.company || fallback.company).trim(),
      message: (saved.message || fallback.message).trim(),
    };
  } catch {
    return fallback;
  }
}
export function saveTemplate(t: WaTemplate) {
  try { localStorage.setItem(WHATSAPP_TEMPLATE_KEY, JSON.stringify(t)); } catch {}
}

/** "This is Usama, Head of Sales at Hawaii Real Estate." (title and company optional) */
export function intro(t: WaTemplate) {
  const name = t.agentName || "Agent";
  if (t.title && t.company) return `This is ${name}, ${t.title} at ${t.company}.`;
  if (t.company) return `This is ${name} from ${t.company}.`;
  if (t.title) return `This is ${name}, ${t.title}.`;
  return `This is ${name}.`;
}

export function ownerMessage(t: WaTemplate, o: { owner?: string | null; unit?: string | null; cluster?: string | null; community?: string | null }) {
  const first = o.owner ? String(o.owner).trim().split(" ")[0] : "Owner";
  return `${t.greeting || "Hello"} Mr. ${first},

${intro(t)}

I'm reaching out regarding your property in ${o.cluster || ""}, Unit #${o.unit || ""}, ${o.community || ""}.

${t.message || ""}

Regards,
${t.agentName || "Agent"}`;
}

export function leadMessage(t: WaTemplate, l: { name?: string | null; project_inquired?: string | null }) {
  return `Hello ${l.name || ""},

${intro(t)}

You inquired about ${l.project_inquired || "a property"}. When is a good time to discuss your requirement?

Regards,
${t.agentName || "Agent"}`;
}

/** Digits for wa.me / tel: (old CRM rules): 00971… → 971…, 5xxxxxxxx → 9715…, 05… → 9715… */
export function formatPhone(phone: string | null | undefined) {
  let p = String(phone || "").replace(/[^\d]/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.substring(2);
  if (p.length === 9 && p.startsWith("5")) p = "971" + p;
  if (p.length === 10 && p.startsWith("05")) p = "971" + p.substring(1);
  return p;
}

export function waLink(phone: string | null | undefined, text: string) {
  const f = formatPhone(phone);
  return f ? `https://wa.me/${f}?text=${encodeURIComponent(text)}` : "";
}

/** WhatsApp/Call on an owner: stamp last contacted, New → Contacted, and log it (as the old CRM). */
export async function markOwnerContacted(id: number, type: "WhatsApp" | "Call", by: string) {
  const today = todayDubai();
  await db.from("owners").update({ last_contacted: today }).eq("id", id);
  await db.from("owners").update({ status: "Contacted" }).eq("id", id).eq("status", "New");
  await db.from("owner_activities").insert({
    owner_id: String(id), activity_type: type,
    details: type === "WhatsApp" ? "WhatsApp message initiated" : "Call initiated", created_by: by,
  });
}

/** WhatsApp/Call on a lead: stamp last contacted, New → Contacted (logged), as lead-contacted-hotfix.js. */
export async function markLeadContacted(id: string, by: string) {
  const { data } = await db.from("leads").select("status").eq("id", id).maybeSingle();
  const current = (data?.status || "New").trim();
  const payload: Record<string, string> = { last_contacted: todayDubai() };
  if (current === "New") payload.status = "Contacted";
  await db.from("leads").update(payload).eq("id", id);
  if (current === "New") {
    await db.from("lead_activities").insert({ lead_id: id, activity_type: "Status Change", details: "Status changed from New to Contacted automatically after contact.", created_by: by });
  }
}

/** Notes shown as "Latest remark": newest manual note; skips automatic contact/status lines. */
export function isSystemActivity(a: { activity_type?: string | null; details?: string | null }) {
  const n = (v: unknown) => String(v ?? "").toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
  const type = n(a.activity_type), details = n(a.details);
  return !details || details === "whatsapp message initiated" || details === "call initiated" || details.startsWith("status changed") || type === "status change";
}

export function downloadCSV(name: string, cols: string[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${todayDubai()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
