"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { PERMISSIONS, ROLE_LABEL, SUPER_ADMIN_EMAIL, type Permission, type Role } from "@/lib/access";
import { Avatar, Badge, Button, Card, Empty, Field, Input, ListSkeleton, PageHeader, Select, StatusBadge, Tabs, cx } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { orSafe } from "@/components/shell/CommandPalette";
import { useDebounced } from "@/lib/hooks";
import { relative } from "@/lib/format";

type UserRow = {
  id?: string; email: string; name: string | null; role: string | null; active: boolean; permissions?: string[] | null; team_leader?: string | null;
  assigned_communities: string[] | null; assigned_clusters: string[] | null; can_export: boolean | null;
  has_login?: boolean; last_sign_in_at?: string | null;
};
const ROLES: Exclude<Role, "super_admin">[] = ["agent", "team_leader", "accounts", "hr", "admin"];

async function call(action: string, body: Record<string, unknown> = {}) {
  const { data, error } = await db.functions.invoke("admin-users", { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return data;
}

export default function UsersPage() {
  return <Suspense><Users /></Suspense>;
}

function Users() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const openKey = params.get("user");

  const users = useQuery({
    queryKey: ["admin-users"],
    enabled: !!me?.isAdmin,
    queryFn: async () => ((await call("list")).users || []) as UserRow[],
  });
  const rows = (users.data || []).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const leadCounts = useQuery({
    queryKey: ["lead-counts-by-user"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const m = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("leads").select("assigned_to").not("assigned_to", "is", null).range(from, from + 999);
        if (error) throw error;
        for (const r of data || []) { const k = (r.assigned_to as string).toLowerCase(); m.set(k, (m.get(k) || 0) + 1); }
        if (!data || data.length < 1000) break;
      }
      return m;
    },
  });
  // The address bar carries the person's record id, never their email or name.
  const go = (key: string | null) => router.push(key ? `/settings/users?user=${encodeURIComponent(key)}` : "/settings/users", { scroll: true });
  const keyOf = (u: UserRow) => u.id || u.email;
  // Old links had the email in them: swap it for the id so the address stays clean.
  useEffect(() => {
    if (!openKey?.includes("@")) return;
    const u = users.data?.find((x) => x.email === openKey.toLowerCase());
    if (u?.id) router.replace(`/settings/users?user=${u.id}`, { scroll: false });
  }, [openKey, users.data, router]);

  if (!me?.isAdmin) return <Card><Empty icon={<ShieldCheck size={28} />} title="Only admins can manage users" /></Card>;

  const editing = openKey && openKey !== "new" ? users.data?.find((u) => keyOf(u) === openKey || u.email === openKey) : undefined;
  if (openKey === "new") return <UserEditor key="new" user={null} all={users.data || []} onClose={() => go(null)} />;
  if (editing) return <UserEditor key={editing.email} user={editing} all={users.data || []} onClose={() => go(null)} />;

  return (
    <div className="animate-in">
      <PageHeader title="Users & access" subtitle="Roles, areas and extra permissions for each person"
        actions={<Button variant="primary" onClick={() => go("new")}><Plus size={16} /> Add user</Button>} />
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="pl-9" />
      </div>
      {users.isLoading ? <ListSkeleton rows={4} /> : users.error ? (
        <Card><Empty title="Could not load users" hint={(users.error as Error).message} /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((u) => (
            <button key={u.email} onClick={() => go(keyOf(u))} className={cx("w-full text-left p-4 flex items-center gap-3 hover:bg-surface-2", !u.active && "opacity-50")}>
              <Avatar name={u.name || u.email} size={34} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink break-words">{u.name || u.email}</div>
                <div className="text-xs text-ink-3 break-words">{u.email}{u.last_sign_in_at ? ` · last sign-in ${relative(u.last_sign_in_at)}` : u.has_login === false ? " · no login yet" : ""}</div>
                <AccessSummary user={u} leads={leadCounts.data?.get(u.email.toLowerCase()) || 0} />
              </div>
              <div className="hidden sm:flex gap-1.5 flex-wrap justify-end">
                {(u.permissions || []).map((p) => <Badge key={p}>{PERMISSIONS[p as Permission] || p}</Badge>)}
              </div>
              <Badge tone={u.email === SUPER_ADMIN_EMAIL || u.role === "admin" ? "accent" : "neutral"}>
                {u.email === SUPER_ADMIN_EMAIL ? "Super Admin" : ROLE_LABEL[(u.role || "agent") as Role] || u.role}
              </Badge>
              {!u.active && <Badge tone="bad">Inactive</Badge>}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function UserEditor({ user, all, onClose }: { user: UserRow | null; all: UserRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = !user;
  const isOwner = user?.email === SUPER_ADMIN_EMAIL;
  const [email, setEmail] = useState(user?.email || "");
  const [name, setName] = useState(user?.name || "");
  const [role, setRole] = useState<string>(user?.role || "agent");
  const [teamLeader, setTeamLeader] = useState(user?.team_leader || "");
  const [perms, setPerms] = useState<Set<string>>(new Set(user?.permissions || []));
  const [areas, setAreas] = useState<Set<string>>(new Set([...(user?.assigned_communities || []), ...(user?.assigned_clusters || [])]));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const opts = useQuery({
    queryKey: ["filter-options-all"],
    staleTime: 30 * 60_000,
    queryFn: async () => ((await db.rpc("crm_filter_options_all")).data || []) as { community: string; cluster: string }[],
  });
  const tree = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of opts.data || []) if (o.community) { const l = m.get(o.community) || []; if (o.cluster && !l.includes(o.cluster)) l.push(o.cluster); m.set(o.community, l); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, l]) => [c, l.sort()] as const);
  }, [opts.data]);
  const leaders = all.filter((u) => u.role === "team_leader" && u.active);

  function toggle<T>(set: Set<T>, v: T) { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; }

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setErr(""); setMsg("");
    try {
      const communities = [...areas].filter((a) => !a.includes("::"));
      const clusters = [...areas].filter((a) => a.includes("::"));
      await call(action, {
        email: email.trim().toLowerCase(), name, role, permissions: [...perms], team_leader: role === "agent" ? teamLeader : "",
        assigned_communities: communities, assigned_clusters: clusters, can_export: perms.has("export"), ...extra,
      });
      qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["staff"] });
      if (action === "set_password") { setMsg("Password changed."); setPassword(""); } else onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }

  const areaLabel = (a: string) => a.replace("::", " · ");

  return (
    <div className="animate-in pb-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink mb-3"><ArrowLeft size={15} /> Users & access</button>
      <PageHeader title={isNew ? "Add user" : user!.name || user!.email} subtitle={isNew ? "Create a login and choose what this person can see" : user!.email} />

      {!isNew && !isOwner && <DatabaseSummary user={user!} />}

      {isOwner ? <Card className="p-5 text-sm text-ink-2">The owner account always has full access and can’t be changed here.</Card> : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-ink mb-4">Profile and role</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isNew} type="email" /></Field>
                <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Role">
                  <Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
                </Field>
                {role === "agent" && (
                  <Field label="Team leader">
                    <Select value={teamLeader} onChange={(e) => setTeamLeader(e.target.value)}>
                      <option value="">None</option>
                      {leaders.map((l) => <option key={l.email} value={l.email}>{l.name || l.email}</option>)}
                    </Select>
                  </Field>
                )}
                {isNew && <Field label="First password (min. 8 characters)" className="sm:col-span-2"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
              </div>
            </Card>

            {role !== "admin" && (
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-ink mb-4">Extra permissions</h2>
                <div className="grid sm:grid-cols-2 gap-2">
                  {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([k, label]) => (
                    <label key={k} className={cx("flex items-center gap-2.5 rounded-lg border px-3 min-h-10 py-2 text-sm cursor-pointer transition-colors", perms.has(k) ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                      <input type="checkbox" className="accent-[var(--accent)]" checked={perms.has(k)} onChange={() => setPerms(toggle(perms, k))} /> {label}
                    </label>
                  ))}
                </div>
              </Card>
            )}

            {!isNew && (
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-ink mb-3">Set a new password</h2>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                  <Button onClick={() => run("set_password", { password })} disabled={!!busy || password.length < 8}>Set</Button>
                </div>
              </Card>
            )}
          </div>

          {role !== "admin" ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-ink">Database assigned (owner areas)</h2>
              <p className="text-xs text-ink-3 mt-0.5 mb-3">{areas.size} selected. Press Save to apply changes.</p>
              {areas.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {[...areas].sort().map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-text pl-2.5 pr-1 py-0.5 text-xs font-medium">
                      {areaLabel(a)}
                      <button type="button" aria-label={`Remove ${areaLabel(a)}`} className="p-0.5 rounded-full hover:bg-surface" onClick={() => setAreas(toggle(areas, a))}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-xl border border-line divide-y divide-line">
                {tree.map(([community, clusters]) => {
                  const picked = clusters.filter((c) => areas.has(`${community}::${c}`)).length;
                  return (
                    <details key={community} className="group" open={picked > 0}>
                      <summary className="flex items-center gap-2.5 px-3 min-h-10 py-2 cursor-pointer text-sm text-ink list-none">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={areas.has(community)} onClick={(e) => e.stopPropagation()} onChange={() => setAreas(toggle(areas, community))} />
                        <span className="flex-1">{community}</span>
                        <span className="text-xs text-ink-3">{picked ? `${picked} of ${clusters.length}` : clusters.length}</span>
                      </summary>
                      {!areas.has(community) && (
                        <div className="grid sm:grid-cols-2 gap-x-3 px-9 pb-2">
                          {clusters.map((c) => (
                            <label key={c} className="flex items-center gap-2 min-h-8 text-sm text-ink-2 cursor-pointer">
                              <input type="checkbox" className="accent-[var(--accent)]" checked={areas.has(`${community}::${c}`)} onChange={() => setAreas(toggle(areas, `${community}::${c}`))} /> {c}
                            </label>
                          ))}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            </Card>
          ) : <Card className="p-5 text-sm text-ink-2">Admins can see every owner and lead, so no areas are needed.</Card>}
        </div>
      )}

      {!isNew && !isOwner && <DeleteUser user={user!} staff={all.filter((u) => u.active && u.email !== user!.email)} onDone={onClose} />}

      {!isNew && <AssignedData email={user!.email} name={user!.name || user!.email} staff={all.filter((u) => u.active)} />}

      {!isOwner && (
        <div className="sticky bottom-20 lg:bottom-4 z-20 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-surface p-3 shadow-pop">
          {msg && <div className="text-sm text-good mr-auto">{msg}</div>}
          {err && <div className="text-sm text-bad mr-auto">{err}</div>}
          {!isNew && <Button variant="ghost" className={msg || err ? "" : "mr-auto"} onClick={() => run(user!.active ? "deactivate" : "reactivate")} disabled={!!busy}>
            {busy === "deactivate" || busy === "reactivate" ? <Loader2 size={15} className="animate-spin" /> : null}{user!.active ? "Deactivate" : "Re-activate"}</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => run(isNew ? "create" : "save", isNew ? { password } : {})} disabled={!!busy}>
            {(busy === "create" || busy === "save") && <Loader2 size={15} className="animate-spin" />}{isNew ? "Create login" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}

type LeadRow = { id: string; name: string | null; phone: string | null; project_inquired: string | null; status: string | null; assigned_to?: string | null };
type OwnerRow = { id: number; community: string | null; cluster: string | null; unit: string | null; owner: string | null; phone1: string | null; status: string | null; assigned_to?: string | null };
const LIST_LIMIT = 500;

/** The leads and owner records given to one person: open them, move them to someone else, or give them more. */
function AssignedData({ email, name, staff }: { email: string; name: string; staff: UserRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"leads" | "owners">("leads");
  const [find, setFind] = useState("");
  const term = orSafe(useDebounced(find.trim(), 250));
  const mine = email.replace(/[\\%_]/g, "\\$&");

  const data = useQuery({
    queryKey: ["assigned-data", email],
    queryFn: async () => {
      const [l, o] = await Promise.all([
        db.from("leads").select("id,name,phone,project_inquired,status", { count: "exact" }).ilike("assigned_to", mine).order("created_at", { ascending: false }).limit(LIST_LIMIT),
        db.from("owners").select("id,community,cluster,unit,owner,phone1,status", { count: "exact" }).ilike("assigned_to", mine).order("community").order("cluster").order("unit").limit(LIST_LIMIT),
      ]);
      if (l.error) throw l.error;
      if (o.error) throw o.error;
      return { leads: (l.data || []) as LeadRow[], leadCount: l.count || 0, owners: (o.data || []) as OwnerRow[], ownerCount: o.count || 0 };
    },
  });
  const found = useQuery({
    queryKey: ["assign-search", tab, term],
    enabled: term.length >= 2,
    queryFn: async () => {
      if (tab === "leads") {
        const r = await db.from("leads").select("id,name,phone,project_inquired,status,assigned_to").or(`name.ilike.%${term}%,phone.ilike.%${term}%`).limit(20);
        return ((r.data || []) as LeadRow[]).filter((x) => x.assigned_to?.toLowerCase() !== email.toLowerCase()).slice(0, 8);
      }
      const r = await db.from("owners").select("id,community,cluster,unit,owner,phone1,status,assigned_to").or(`owner.ilike.%${term}%,unit.ilike.%${term}%,phone1.ilike.%${term}%`).limit(20);
      return ((r.data || []) as OwnerRow[]).filter((x) => x.assigned_to?.toLowerCase() !== email.toLowerCase()).slice(0, 8);
    },
  });
  const refresh = () => {
    for (const k of ["assigned-data", "assign-search", "leads", "owners", "lead", "owner"]) qc.invalidateQueries({ queryKey: [k] });
  };
  async function assign(table: "leads" | "owners", id: string | number, to: string) {
    const { error } = await db.from(table).update({ assigned_to: to || null }).eq("id", id);
    if (error) { toast(error.message); return; }
    toast(to ? "Assigned" : "Unassigned"); refresh();
  }
  async function moveAll(to: string) {
    const total = tab === "leads" ? data.data?.leadCount : data.data?.ownerCount;
    const who = to === "__none" ? "nobody" : staff.find((s) => s.email === to)?.name || to;
    if (!to || !total || !confirm(`Move all ${total} ${tab} from ${name} to ${who}?`)) return;
    const { error } = await db.from(tab).update({ assigned_to: to === "__none" ? null : to }).ilike("assigned_to", mine);
    if (error) { toast(error.message); return; }
    toast("Moved"); refresh();
  }
  const AssignSelect = ({ table, id }: { table: "leads" | "owners"; id: string | number }) => (
    <select value={email} aria-label="Assigned to" onChange={(e) => assign(table, id, e.target.value)}
      className="field-sizing-content h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink-2 outline-none hover:border-line-strong focus:border-accent">
      <option value="">Unassigned</option>
      {!staff.some((s) => s.email === email) && <option value={email}>{name}</option>}
      {staff.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
    </select>
  );
  const rows = tab === "leads" ? data.data?.leads : data.data?.owners;
  const total = tab === "leads" ? data.data?.leadCount : data.data?.ownerCount;

  return (
    <Card className="p-5 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Assigned to {name}</h2>
          <p className="text-xs text-ink-3 mt-0.5">Changes here save straight away.</p>
        </div>
        {!!total && (
          <select value="" aria-label="Move all" onChange={(e) => moveAll(e.target.value)} className="field-sizing-content h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink-2 outline-none hover:border-line-strong">
            <option value="">Move all {tab} to…</option>
            <option value="__none">Unassigned</option>
            {staff.filter((s) => s.email !== email).map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </select>
        )}
      </div>
      <Tabs className="mb-4" value={tab} onChange={(t) => { setTab(t); setFind(""); }} options={[
        { value: "leads", label: "Leads", n: data.data?.leadCount },
        { value: "owners", label: "Single owner records", n: data.data?.ownerCount },
      ]} />

      <div className="relative max-w-md mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tab === "leads" ? "Find a lead by name or phone to assign" : "Find an owner by name, unit or phone to assign"} className="pl-9" />
      </div>
      {term.length >= 2 && (
        <div className="rounded-xl border border-line divide-y divide-line mb-4">
          {found.data?.length === 0 && <div className="px-3 py-2.5 text-sm text-ink-3">No match to assign.</div>}
          {found.data?.map((x) => {
            const owner = "unit" in x;
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="flex-1 min-w-48 text-ink break-words">{owner ? `${x.owner || "—"} · ${x.cluster} ${x.unit}` : x.name || "Unnamed"}</span>
                <span className="text-xs text-ink-3">{x.assigned_to ? `Now with ${staff.find((s) => s.email === x.assigned_to)?.name || x.assigned_to}` : "Unassigned"}</span>
                <Button size="sm" onClick={() => assign(owner ? "owners" : "leads", x.id, email)}>Assign</Button>
              </div>
            );
          })}
        </div>
      )}

      {data.isLoading ? <ListSkeleton rows={3} /> : data.error ? <div className="text-sm text-bad">{(data.error as Error).message}</div> : !rows?.length ? (
        <div className="py-8 text-center text-sm text-ink-3">Nothing assigned yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-2 border-b border-line">
              {(tab === "leads" ? ["Name", "Phone", "Project", "Status", "Assigned to"] : ["Unit", "Cluster", "Owner", "Status", "Assigned to"]).map((h) => <th key={h} className="font-semibold px-2 py-2 whitespace-nowrap first:pl-0">{h}</th>)}
            </tr></thead>
            <tbody>
              {tab === "leads" ? data.data!.leads.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2"><Link href={`/leads?open=${l.id}`} className="font-medium text-ink hover:text-accent-text">{l.name || "Unnamed"}</Link></td>
                  <td className="px-2 py-2 num text-ink-2 whitespace-nowrap">{l.phone || "—"}</td>
                  <td className="px-2 py-2 text-ink-2">{l.project_inquired || "—"}</td>
                  <td className="px-2 py-2"><StatusBadge status={l.status} /></td>
                  <td className="px-2 py-2"><AssignSelect table="leads" id={l.id} /></td>
                </tr>
              )) : data.data!.owners.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2 font-semibold text-ink num whitespace-nowrap">{o.unit}</td>
                  <td className="px-2 py-2 text-ink-2">{o.cluster}</td>
                  <td className="px-2 py-2"><Link href={`/owners?open=${o.id}`} className="font-medium text-ink hover:text-accent-text">{o.owner || "—"}</Link></td>
                  <td className="px-2 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-2 py-2"><AssignSelect table="owners" id={o.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(total || 0) > LIST_LIMIT && <div className="text-xs text-ink-3 mt-2">Showing the first {LIST_LIMIT} of {total}.</div>}
        </div>
      )}
    </Card>
  );
}

const areaName = (a: string) => a.replace("::", " · ");
const userAreas = (u: UserRow) => [...(u.assigned_communities || []), ...(u.assigned_clusters || [])];
const isAllAccess = (u: UserRow) => u.email === SUPER_ADMIN_EMAIL || u.role === "admin";

/** One line under each person on the users list: which database (areas) and how many leads they have. */
function AccessSummary({ user, leads }: { user: UserRow; leads: number }) {
  if (isAllAccess(user)) return <div className="text-xs text-ink-2 mt-1">Database: everything</div>;
  const areas = userAreas(user);
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
      <span className="text-ink-3">Database:</span>
      {areas.length ? areas.map((a) => <span key={a} className="rounded-full bg-accent-soft text-accent-text px-2 py-0.5 font-medium">{areaName(a)}</span>)
        : <span className="text-ink-3">none</span>}
      <span className="text-ink-3">· {leads} lead{leads === 1 ? "" : "s"} assigned</span>
    </div>
  );
}

/** Top of a person's page: exactly what they can see, with counts. */
function DatabaseSummary({ user }: { user: UserRow }) {
  const areas = userAreas(user);
  const counts = useQuery({
    queryKey: ["database-summary", user.email, areas.join("|")],
    queryFn: async () => {
      const mine = user.email.replace(/[\\%_]/g, "\\$&");
      const per = await Promise.all(areas.map(async (a) => {
        const [community, cluster] = a.split("::");
        let q = db.from("owners").select("id", { count: "exact", head: true });
        q = cluster ? q.eq("community", community).eq("cluster", cluster) : q.eq("community", community);
        const r = await q;
        return [a, r.count || 0] as const;
      }));
      const [l, o] = await Promise.all([
        db.from("leads").select("id", { count: "exact", head: true }).ilike("assigned_to", mine),
        db.from("owners").select("id", { count: "exact", head: true }).ilike("assigned_to", mine),
      ]);
      return { per, leads: l.count || 0, ownersSingle: o.count || 0 };
    },
  });
  const name = user.name || user.email;
  return (
    <Card className="p-5 mb-4">
      <h2 className="text-sm font-semibold text-ink mb-3">What {name} can see</h2>
      {isAllAccess(user) ? <div className="text-sm text-ink-2">Everything (admin).</div> : (
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-ink-3 mb-1.5">Database (owner areas)</div>
            {areas.length ? (
              <div className="flex flex-wrap gap-1.5">
                {areas.map((a) => {
                  const n = counts.data?.per.find(([k]) => k === a)?.[1];
                  return <span key={a} className="rounded-full bg-accent-soft text-accent-text px-2.5 py-0.5 text-xs font-medium">{areaName(a)}{n !== undefined ? ` · ${n.toLocaleString()} owners` : ""}</span>;
                })}
              </div>
            ) : <div className="text-ink-3">None assigned. Pick areas below and press Save.</div>}
          </div>
          <div>
            <div className="text-xs font-medium text-ink-3 mb-1.5">Leads</div>
            <div className="text-ink"><span className="num font-semibold">{counts.data?.leads ?? "…"}</span> assigned</div>
            <div className="text-xs text-ink-3 mt-0.5">{user.role === "team_leader" ? "Also sees their team’s leads." : "Sees only the leads assigned to them."}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-3 mb-1.5">Single owner records</div>
            <div className="text-ink"><span className="num font-semibold">{counts.data?.ownersSingle ?? "…"}</span> given one by one</div>
            <div className="text-xs text-ink-3 mt-0.5">Outside their areas. Manage them at the bottom of this page.</div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Delete a person: no more sign-in, no access, and their leads and owners go to someone else. */
function DeleteUser({ user, staff, onDone }: { user: UserRow; staff: UserRow[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const name = user.name || user.email;
  async function del() {
    const to = staff.find((s) => s.email === moveTo);
    if (!confirm(`Delete ${name}?\n\nThey can no longer sign in or see anything in the CRM. Their leads and owner records go to ${to ? to.name || to.email : "nobody (unassigned)"}. This can't be undone.`)) return;
    setBusy(true); setErr("");
    try {
      await call("delete", { email: user.email, move_to: moveTo });
      for (const k of ["admin-users", "staff", "leads", "owners", "lead-counts-by-user"]) qc.invalidateQueries({ queryKey: [k] });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <Card className="p-5 mt-4 border-bad/30">
      <h2 className="text-sm font-semibold text-bad">Delete user</h2>
      <p className="text-xs text-ink-3 mt-0.5 mb-3">Removes their login and all their access for good. To stop them for a while instead, use Deactivate.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Give their leads and owner records to" className="min-w-64">
          <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Nobody (unassigned)</option>
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </Select>
        </Field>
        <Button onClick={del} disabled={busy} className="!text-bad !border-bad/40">{busy && <Loader2 size={15} className="animate-spin" />}Delete {name}</Button>
      </div>
      {err && <div className="text-sm text-bad mt-2">{err}</div>}
    </Card>
  );
}
