// Admin-only user management for the CRM.
// The service-role key never leaves Supabase: it is read from the function's environment.
// Every request is checked: the caller's own JWT must belong to an active admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = "thechussar@gmail.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const clean = (v: unknown) => String(v ?? "").trim();
const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(clean).filter(Boolean))] : []);
const BAN_FOREVER = "876000h";

async function callerIsAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  if (email === OWNER_EMAIL) return email;
  const { data: row } = await admin.from("user_access").select("role,active").ilike("email", email).maybeSingle();
  return row?.role === "admin" && row?.active ? email : null;
}

async function findAuthUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const caller = await callerIsAdmin(req);
  if (!caller) return json({ error: "Only an active administrator can manage users." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = clean(body.action);
  const email = clean(body.email).toLowerCase();

  try {
    if (action === "list") {
      const { data: rows, error } = await admin.from("user_access").select("*").order("email");
      if (error) throw error;
      const users = [];
      for (const row of rows ?? []) {
        const u = await findAuthUser(String(row.email).toLowerCase());
        users.push({ ...row, has_login: !!u, last_sign_in_at: u?.last_sign_in_at ?? null });
      }
      return json({ users });
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
    if (email === OWNER_EMAIL && action !== "save") return json({ error: "The owner account cannot be changed here." }, 400);

    if (action === "create") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "The initial password must be at least 8 characters." }, 400);
      if (await findAuthUser(email)) return json({ error: "A login with this email already exists." }, 409);
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name: clean(body.name) },
      });
      if (error) throw error;
      const { error: accessError } = await admin.from("user_access").upsert({
        email, name: clean(body.name) || null, role: body.role === "admin" ? "admin" : "agent",
        assigned_communities: list(body.assigned_communities), assigned_clusters: list(body.assigned_clusters),
        can_export: !!body.can_export, active: true, user_id: created.user.id, updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
      if (accessError) throw accessError;
      return json({ ok: true });
    }

    if (action === "save") {
      if (email === OWNER_EMAIL) return json({ error: "The owner account always has full access." }, 400);
      const { error } = await admin.from("user_access").update({
        name: clean(body.name) || null, role: body.role === "admin" ? "admin" : "agent",
        assigned_communities: list(body.assigned_communities), assigned_clusters: list(body.assigned_clusters),
        can_export: !!body.can_export, updated_at: new Date().toISOString(),
      }).ilike("email", email);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "deactivate" || action === "reactivate") {
      const active = action === "reactivate";
      const u = await findAuthUser(email);
      if (u) {
        const { error } = await admin.auth.admin.updateUserById(u.id, { ban_duration: active ? "none" : BAN_FOREVER });
        if (error) throw error;
      }
      // The ban stops new sign-ins and token refreshes; the database rules check `active`
      // on every request, so a deactivated user loses data access immediately.
      const { error } = await admin.from("user_access").update({ active, updated_at: new Date().toISOString() }).ilike("email", email);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "set_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "The new password must be at least 8 characters." }, 400);
      const u = await findAuthUser(email);
      if (!u) return json({ error: "This user has no login yet." }, 404);
      const { error } = await admin.auth.admin.updateUserById(u.id, { password });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: (e as Error).message || "Request failed" }, 500);
  }
});
