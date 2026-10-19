import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Cluster Guide API: list (summary), get one guide, and admin save/delete. Readable by active CRM users.
const CRM_ADMIN_EMAIL = "thechussar@gmail.com";
const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch { return ""; }
})();
const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const cleanText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const cleanNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

function cleanCluster(input: any) {
  const unitMix = Array.isArray(input?.unit_mix)
    ? input.unit_mix.slice(0, 100).map((row: any) => ({
        unit_type: cleanText(row?.unit_type, 100),
        bedrooms: cleanText(row?.bedrooms, 30),
        units: Math.floor(cleanNumber(row?.units)),
        layouts: Array.isArray(row?.layouts)
          ? row.layouts.slice(0, 50).map((item: unknown) => cleanText(item, 150)).filter(Boolean)
          : [],
        layout_count: Math.floor(cleanNumber(row?.layout_count)),
        bua_min_sqft: cleanNumber(row?.bua_min_sqft),
        bua_max_sqft: cleanNumber(row?.bua_max_sqft),
        plot_min_sqft: cleanNumber(row?.plot_min_sqft),
        plot_max_sqft: cleanNumber(row?.plot_max_sqft),
        op_min_aed: cleanNumber(row?.op_min_aed),
        op_max_aed: cleanNumber(row?.op_max_aed),
        ...(row?.dld_area_min_sqft ? { dld_area_min_sqft: cleanNumber(row.dld_area_min_sqft), dld_area_max_sqft: cleanNumber(row.dld_area_max_sqft), dld_sales: Math.floor(cleanNumber(row.dld_sales)) } : {}),
        ...(row?.dld_plot_min_sqft ? { dld_plot_min_sqft: cleanNumber(row.dld_plot_min_sqft), dld_plot_max_sqft: cleanNumber(row.dld_plot_max_sqft), dld_plot_sales: Math.floor(cleanNumber(row.dld_plot_sales)) } : {}),
      }))
    : [];

  return {
    name: cleanText(input?.name, 200),
    community: cleanText(input?.community, 200),
    total_units: Math.floor(cleanNumber(input?.total_units)) || unitMix.reduce((sum: number, row: any) => sum + row.units, 0),
    launch_date: cleanText(input?.launch_date, 100),
    handover_date: cleanText(input?.handover_date, 100),
    payment_plan: cleanText(input?.payment_plan, 4000),
    usp: cleanText(input?.usp, 6000),
    unit_mix: unitMix,
    developer: cleanText(input?.developer, 200) || null,
    development_type: cleanText(input?.development_type, 200) || null,
    original_price_note: cleanText(input?.original_price_note, 1000) || null,
    open_questions: cleanText(input?.open_questions, 2000) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: auth_, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth_?.user) return json({ error: "Invalid CRM session" }, 401);
  const user = auth_.user;
  const email = String(user.email || "").toLowerCase();
  const { data: access } = await admin.from("user_access").select("role,active").ilike("email", email).maybeSingle();
  const isActive = email === CRM_ADMIN_EMAIL || access?.active === true;
  const isCrmAdmin = email === CRM_ADMIN_EMAIL || (access?.role === "admin" && access?.active === true);
  if (!isActive) return json({ error: "This account has no CRM access." }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = String(body.action || "");
  try {
    if (action === "listClusters") {
      // Summary only; the full guide is loaded when a cluster is opened (getCluster).
      const { data, error } = await admin.from("cluster_guides")
        .select("id,name,community,developer,development_type,total_units,handover_date,unit_mix,verified_on")
        .order("community", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      const clusters = (data || []).map((c: any) => ({
        id: c.id, name: c.name, community: c.community, developer: c.developer, development_type: c.development_type,
        total_units: c.total_units, handover_date: c.handover_date, verified_on: c.verified_on,
        bedrooms: (c.unit_mix || []).map((m: any) => String(m.bedrooms)).filter(Boolean),
      }));
      return json({ clusters, canEdit: isCrmAdmin });
    }

    if (action === "getCluster") {
      const id = cleanText(body.id, 100);
      const { data, error } = await admin.from("cluster_guides").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Not found" }, 404);
      return json({ cluster: data, canEdit: isCrmAdmin });
    }

    if (action === "saveCluster") {
      if (!isCrmAdmin) return json({ error: "Admin access required" }, 403);
      const cluster = cleanCluster(body.cluster || {});
      if (!cluster.name) return json({ error: "Cluster name is required" }, 400);
      const id = cleanText(body.cluster?.id, 100);
      const payload = {
        ...cluster,
        updated_by: user.email || user.id,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { data, error } = await admin.from("cluster_guides").update(payload).eq("id", id).select("*").single();
        if (error) throw error;
        return json({ cluster: data });
      }
      const { data, error } = await admin.from("cluster_guides").insert({
        ...payload,
        created_by: user.email || user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ cluster: data });
    }

    if (action === "deleteCluster") {
      if (!isCrmAdmin) return json({ error: "Admin access required" }, 403);
      const id = cleanText(body.id, 100);
      if (!id) return json({ error: "Cluster ID is required" }, 400);
      const { error } = await admin.from("cluster_guides").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : cleanText((error as any)?.message || error, 2000);
    const status = (error as any)?.code === "23505" ? 409 : 500;
    return json({ error: status === 409 ? "This cluster already exists in this community." : message }, status);
  }
});
