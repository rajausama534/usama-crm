/** One colour per status, the same mapping the old CRM used (crm-status-system.js). Colours live in globals.css. */
const MAP: Record<string, string> = {
  New: "blue", Contacted: "lime", "For Sale": "green", "For Rent": "indigo", Sold: "gold", "Call Back": "purple",
  "No Response": "slate", "Not Interested": "red", "Invalid Number": "grey", Agent: "orange", Rented: "teal",
  Interested: "green", "Viewing Scheduled": "cyan", "Visit Done": "teal", Negotiation: "orange", Won: "emerald", Lost: "red",
};
const FALLBACK = ["slate", "indigo", "teal", "purple", "blue", "orange"];

export function statusTone(status: string | null | undefined): string {
  const s = (status || "").trim();
  if (!s) return "slate";
  if (MAP[s]) return MAP[s];
  return FALLBACK[[...s.toLowerCase()].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % FALLBACK.length];
}
