import type { Tone } from "@/components/ui";
import { db } from "@/lib/supabase";

export const LEAD_STAGES = ["New", "Contacted", "No Response", "Interested", "Viewing Scheduled", "Visit Done", "Negotiation", "Won", "Lost"] as const;
export const STAGE_TONE: Record<string, Tone> = {
  New: "accent", Contacted: "neutral", "No Response": "neutral", Interested: "warn", "Viewing Scheduled": "warn",
  "Visit Done": "warn", Negotiation: "accent", Won: "good", Lost: "bad",
};

export const OWNER_STATUSES = ["New", "Contacted", "Call Back", "No Response", "Not Interested", "For Sale", "For Rent", "Sold", "Rented", "Agent", "Invalid Number"] as const;
/** Standard statuses plus the admin's own (table crm_owner_statuses, migration 20261110120000). Falls back to the
 *  standard list if the table isn't there yet. Works with the browser client and Bunty's server client. */
export async function loadOwnerStatuses(client: { from: typeof db.from } = db): Promise<string[]> {
  const { data, error } = await client.from("crm_owner_statuses").select("name").order("sort_order").order("name");
  const extra = error ? [] : (data || []).map((r: { name: string }) => r.name).filter((n: string) => !(OWNER_STATUSES as readonly string[]).includes(n));
  return [...OWNER_STATUSES, ...extra];
}

export const OWNER_STATUS_TONE: Record<string, Tone> = {
  New: "accent", Contacted: "neutral", "Call Back": "warn", "No Response": "neutral", "Not Interested": "bad",
  "For Sale": "good", "For Rent": "good", Sold: "neutral", Rented: "neutral", Agent: "neutral", "Invalid Number": "bad",
};

export const EVENT_TYPES = ["Phone Call", "Follow-Up", "Call Back", "Meeting", "Property Viewing", "Reminder", "Task", "Other"] as const;
/** Completing these asks for the phone's location (stored by the database, as in the old CRM). */
export const LOCATION_EVENTS = new Set(["Meeting", "Property Viewing"]);

export type Lead = {
  id: string; created_at: string; lead_receive_date: string | null; name: string | null; phone: string | null; email: string | null;
  project_inquired: string | null; budget: string | null; property_type: string | null; bedroom: string | null; source: string | null;
  status: string | null; follow_up_date: string | null; follow_up_time: string | null; notes: string | null;
  last_contacted: string | null; assigned_to: string | null;
};
export type Owner = {
  id: number; community: string | null; cluster: string | null; unit: string | null; owner: string | null;
  phone1: string | null; phone2: string | null; email: string | null; remarks: string | null; data_source: string | null;
  status: string | null; last_contacted: string | null; follow_up_date: string | null; assigned_to: string | null;
  admin_remarks: string | null; agent_remarks: string | null; manager_remarks: string | null; is_primary: boolean | null;
};
export type CrmEvent = {
  id: string; lead_id: string | null; event_type: string; title: string; notes: string | null; starts_at: string; ends_at: string | null;
  status: string; completed_at: string | null; remind_minutes: number; assigned_to: string; created_by: string; outcome: string | null;
};
export type Activity = { id: number; activity_type: string; details: string | null; created_by: string | null; created_at: string };

export async function logLeadActivity(leadId: string, type: string, details: string, by: string) {
  await db.from("lead_activities").insert({ lead_id: leadId, activity_type: type, details, created_by: by });
}
export async function logOwnerActivity(ownerId: number, type: string, details: string, by: string) {
  await db.from("owner_activities").insert({ owner_id: String(ownerId), activity_type: type, details, created_by: by });
}

/** The phone's current position, or why it could not be read. */
export function readLocation(): Promise<{ status: string; lat?: number; lng?: number; acc?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ status: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: "captured", lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ status: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

// Lead dropdown values (same lists as the old CRM).
export const LEAD_SOURCES = ["Bayut", "Property Finder", "Dubizzle", "Meta Ads", "Instagram", "TikTok", "WhatsApp", "Referral", "Agent", "Broker", "Walk-in", "Website", "Listings", "Other"];
export const PROPERTY_TYPES = ["Apartment", "Villa", "Townhouse", "Penthouse", "Plot", "Commercial"];
export const BEDROOMS = ["Studio", "1BR", "2BR", "3BR", "4BR", "5BR", "6BR", "7BR+"];
