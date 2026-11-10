// Listing feeds read by the portals and the company website. No login: the database function behind them
// (crm_listings_feed) returns only adverts that are live with a Trakheesi permit in date, and only public fields.

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vnydxkmhrcesdffpfjpc.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_VP8ZvA5up64JFGkn5_7qbg_NYVJvt-I";

type Row = {
  ref: string; purpose: "sale" | "rent"; property_type: string | null; community: string | null; cluster: string | null; bedrooms: string | null; bathrooms: number | null;
  bua_sqft: number | null; plot_sqft: number | null; price: number | null; title: string | null; description: string | null; permit_no: string | null; photos: string[] | null;
  portals: Record<string, boolean> | null; agent_name: string | null; agent_email: string | null; agent_phone: string | null; agent_brn: string | null; updated_at: string;
};

const x = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const cdata = (v: unknown) => `<![CDATA[${String(v ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const beds = (b: string | null) => (!b ? "" : /studio/i.test(b) ? "0" : (b.match(/\d+/)?.[0] || ""));
const stamp = (iso: string) => iso.slice(0, 19).replace("T", " ");
// Property Finder's two-letter property codes.
const PF_TYPE: Record<string, string> = { Apartment: "AP", Villa: "VH", Townhouse: "TH", Penthouse: "PH", Plot: "LP", Commercial: "OF" };

function propertyFinder(rows: Row[]) {
  const now = stamp(new Date().toISOString());
  return `<?xml version="1.0" encoding="UTF-8"?>\n<list last_update="${now}" listing_count="${rows.length}">\n${rows.map((r) => `  <property last_update="${stamp(r.updated_at)}">
    <reference_number>${x(r.ref)}</reference_number>
    <permit_number>${x(r.permit_no)}</permit_number>
    <offering_type>${r.purpose === "rent" ? "RR" : "RS"}</offering_type>
    <property_type>${PF_TYPE[r.property_type || ""] || "AP"}</property_type>
    <price_on_application>No</price_on_application>
    <price>${r.purpose === "rent" ? `<yearly>${Math.round(Number(r.price) || 0)}</yearly>` : Math.round(Number(r.price) || 0)}</price>
    <city>Dubai</city>
    <community>${cdata(r.community)}</community>
    <sub_community>${cdata(r.cluster)}</sub_community>
    <title_en>${cdata(r.title)}</title_en>
    <description_en>${cdata(r.description)}</description_en>
    <size>${r.bua_sqft ?? ""}</size>
    <plot_size>${r.plot_sqft ?? ""}</plot_size>
    <bedroom>${beds(r.bedrooms)}</bedroom>
    <bathroom>${r.bathrooms ?? ""}</bathroom>
    <agent><name>${cdata(r.agent_name)}</name><email>${x(r.agent_email)}</email><phone>${x(r.agent_phone)}</phone><license_no>${x(r.agent_brn)}</license_no></agent>
    <photo>${(r.photos || []).map((u) => `<url last_updated="${stamp(r.updated_at)}" watermark="yes">${x(u)}</url>`).join("")}</photo>
  </property>`).join("\n")}\n</list>\n`;
}

function bayut(rows: Row[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Properties>\n${rows.map((r) => `  <Property>
    <Property_Ref_No>${cdata(r.ref)}</Property_Ref_No>
    <Permit_Number>${cdata(r.permit_no)}</Permit_Number>
    <Property_Status>live</Property_Status>
    <Property_purpose>${r.purpose === "rent" ? "Rent" : "Buy"}</Property_purpose>
    <Property_Type>${cdata(r.property_type)}</Property_Type>
    <City>${cdata("Dubai")}</City>
    <Locality>${cdata(r.community)}</Locality>
    <Sub_Locality>${cdata(r.cluster)}</Sub_Locality>
    <Property_Title>${cdata(r.title)}</Property_Title>
    <Property_Description>${cdata(r.description)}</Property_Description>
    <Property_Size>${r.bua_sqft ?? ""}</Property_Size>
    <Property_Size_Unit>SQFT</Property_Size_Unit>
    <Bedrooms>${beds(r.bedrooms)}</Bedrooms>
    <Bathrooms>${r.bathrooms ?? ""}</Bathrooms>
    <Price>${Math.round(Number(r.price) || 0)}</Price>
    ${r.purpose === "rent" ? "<Rent_Frequency>Yearly</Rent_Frequency>" : ""}
    <Listing_Agent>${cdata(r.agent_name)}</Listing_Agent>
    <Listing_Agent_Phone>${cdata(r.agent_phone)}</Listing_Agent_Phone>
    <Listing_Agent_Email>${cdata(r.agent_email)}</Listing_Agent_Email>
    <Images>${(r.photos || []).map((u) => `<Image>${cdata(u)}</Image>`).join("")}</Images>
    <Last_Updated>${stamp(r.updated_at)}</Last_Updated>
    <Portals><Portal>Bayut</Portal><Portal>dubizzle</Portal></Portals>
  </Property>`).join("\n")}\n</Properties>\n`;
}

const PORTAL: Record<string, string> = { "property-finder": "property_finder", bayut: "bayut", website: "website" };

export async function GET(_req: Request, ctx: { params: Promise<{ portal: string }> }) {
  const { portal } = await ctx.params;
  const key = PORTAL[portal];
  if (!key) return Response.json({ error: "Unknown feed" }, { status: 404 });
  const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("crm_listings_feed");
  if (error) return Response.json({ error: "The listings feed is not switched on yet." }, { status: 503 });
  const rows = ((data || []) as Row[]).filter((r) => r.portals?.[key] !== false);
  const cache = { "cache-control": "public, max-age=300" };
  if (portal === "website") return Response.json({ updated: new Date().toISOString(), count: rows.length, listings: rows.map(({ portals, ...r }) => { void portals; return r; }) }, { headers: { ...cache, "access-control-allow-origin": "*" } });
  return new Response(portal === "bayut" ? bayut(rows) : propertyFinder(rows), { headers: { ...cache, "content-type": "application/xml; charset=utf-8" } });
}
