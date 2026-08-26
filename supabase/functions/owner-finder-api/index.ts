import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CRM_URL = "https://vnydxkmhrcesdffpfjpc.supabase.co";
const CRM_KEY = "sb_publishable_VP8ZvA5up64JFGkn5_7qbg_NYVJvt-I";
const CRM_ADMIN_EMAIL = "thechussar@gmail.com";

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
      }))
    : [];

  return {
    name: cleanText(input?.name, 200),
    community: cleanText(input?.community, 200),
    total_units: unitMix.reduce((sum: number, row: any) => sum + row.units, 0),
    launch_date: cleanText(input?.launch_date, 100),
    handover_date: cleanText(input?.handover_date, 100),
    payment_plan: cleanText(input?.payment_plan, 4000),
    usp: cleanText(input?.usp, 6000),
    unit_mix: unitMix,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not signed in" }, 401);

  const verify = await fetch(`${CRM_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: CRM_KEY },
  });
  if (!verify.ok) return json({ error: "Invalid CRM session" }, 401);
  const user = await verify.json();
  const isCrmAdmin = String(user.email || "").toLowerCase() === CRM_ADMIN_EMAIL;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const action = String(body.action || "");

  try {
    if (action === "stats") {
      const [{ count: files, error: e1 }, { count: rows, error: e2 }] = await Promise.all([
        admin.from("owner_finder_files").select("*", { count: "exact", head: true }).eq("status", "complete"),
        admin.from("owner_finder_records").select("*", { count: "exact", head: true }),
      ]);
      if (e1 || e2) throw e1 || e2;
      const { data: fileRows, error: e3 } = await admin
        .from("owner_finder_files")
        .select("id,file_name,file_size,rows_count,status,uploaded_by,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (e3) throw e3;
      return json({ files: files || 0, rows: rows || 0, fileRows: fileRows || [] });
    }

    if (action === "search") {
      const q = String(body.q || "").trim();
      if (!q) return json({ rows: [] });
      const { data, error } = await admin.rpc("owner_finder_search", { search_term: q, result_limit: 250 });
      if (error) throw error;
      return json({ rows: data || [] });
    }

    if (action === "startUpload") {
      const fileName = String(body.fileName || "").slice(0, 500);
      const fileHash = String(body.fileHash || "").slice(0, 128);
      const fileSize = Number(body.fileSize || 0);
      const rowsCount = Number(body.rowsCount || 0);
      if (!fileName || !fileHash) return json({ error: "Missing file information" }, 400);
      const { data: existing } = await admin
        .from("owner_finder_files")
        .select("id,file_name,rows_count,status")
        .eq("file_hash", fileHash)
        .maybeSingle();
      if (existing?.status === "complete") return json({ duplicate: true, file: existing });
      if (existing?.id) {
        await admin.from("owner_finder_records").delete().eq("file_id", existing.id);
        await admin.from("owner_finder_files").delete().eq("id", existing.id);
      }
      const { data, error } = await admin.from("owner_finder_files").insert({
        file_name: fileName,
        file_size: fileSize,
        file_hash: fileHash,
        rows_count: rowsCount,
        status: "uploading",
        uploaded_by: user.email || user.id,
      }).select("id").single();
      if (error) throw error;
      return json({ fileId: data.id });
    }

    if (action === "uploadBatch") {
      const fileId = String(body.fileId || "");
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!fileId || !rows.length) return json({ error: "Missing upload rows" }, 400);
      if (rows.length > 500) return json({ error: "Batch too large" }, 400);
      const payload = rows.map((row: any) => ({
        file_id: fileId,
        owner_name: String(row.ownerName || "").slice(0, 1000),
        phones: String(row.phones || "").slice(0, 1000),
        email: String(row.email || "").slice(0, 1000),
        property: String(row.property || "").slice(0, 2000),
        searchable: String(row.searchable || "").slice(0, 20000),
        source_sheet: String(row.sheetName || "").slice(0, 500),
        source_row: Number(row.rowNo || 0) || null,
        row_data: row.row && typeof row.row === "object" ? row.row : {},
      }));
      const { error } = await admin.from("owner_finder_records").insert(payload);
      if (error) throw error;
      return json({ inserted: payload.length });
    }

    if (action === "finishUpload") {
      const { error } = await admin.from("owner_finder_files").update({
        status: "complete",
        updated_at: new Date().toISOString(),
      }).eq("id", String(body.fileId || ""));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "failUpload") {
      const fileId = String(body.fileId || "");
      if (fileId) {
        await admin.from("owner_finder_files").update({
          status: "failed",
          updated_at: new Date().toISOString(),
        }).eq("id", fileId);
      }
      return json({ ok: true });
    }

    if (action === "deleteFile") {
      const { error } = await admin.from("owner_finder_files").delete().eq("id", String(body.fileId || ""));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "clearAll") {
      const { error } = await admin.from("owner_finder_files").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "listClusters") {
      const { data, error } = await admin.from("cluster_guides").select("*").order("name", { ascending: true });
      if (error) throw error;
      return json({ clusters: data || [], canEdit: isCrmAdmin });
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
