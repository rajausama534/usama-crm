"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Search, ShieldCheck } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { PERMISSIONS, ROLE_LABEL, SUPER_ADMIN_EMAIL, type Permission, type Role } from "@/lib/access";
import { Avatar, Badge, Button, Card, Empty, Field, Input, ListSkeleton, PageHeader, Select, Sheet, cx } from "@/components/ui";
import { relative } from "@/lib/format";

type UserRow = {
  email: string; name: string | null; role: string | null; active: boolean; permissions?: string[] | null; team_leader?: string | null;
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
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<UserRow | "new" | null>(null);

  const users = useQuery({
    queryKey: ["admin-users"],
    enabled: !!me?.isAdmin,
    queryFn: async () => ((await call("list")).users || []) as UserRow[],
  });
  const rows = (users.data || []).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  if (!me?.isAdmin) return <Card><Empty icon={<ShieldCheck size={28} />} title="Only admins can manage users" /></Card>;

  return (
    <div className="animate-in">
      <PageHeader title="Users & access" subtitle="Roles, areas and extra permissions for each person"
        actions={<Button variant="primary" onClick={() => setOpen("new")}><Plus size={16} /> Add user</Button>} />
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="pl-9" />
      </div>
      {users.isLoading ? <ListSkeleton rows={4} /> : users.error ? (
        <Card><Empty title="Could not load users" hint={(users.error as Error).message} /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((u) => (
            <button key={u.email} onClick={() => setOpen(u)} className={cx("w-full text-left p-4 flex items-center gap-3 hover:bg-surface-2", !u.active && "opacity-50")}>
              <Avatar name={u.name || u.email} size={34} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink truncate">{u.name || u.email}</div>
                <div className="text-xs text-ink-3 truncate">{u.email}{u.last_sign_in_at ? ` · last sign-in ${relative(u.last_sign_in_at)}` : u.has_login === false ? " · no login yet" : ""}</div>
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
      {open && <UserSheet user={open === "new" ? null : open} all={users.data || []} onClose={() => setOpen(null)} />}
    </div>
  );
}

function UserSheet({ user, all, onClose }: { user: UserRow | null; all: UserRow[]; onClose: () => void }) {
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

  return (
    <Sheet open onClose={onClose} wide title={isNew ? "Add user" : user!.name || user!.email} footer={!isOwner && <>
      {!isNew && <Button variant="ghost" className="mr-auto" onClick={() => run(user!.active ? "deactivate" : "reactivate")} disabled={!!busy}>
        {busy === "deactivate" || busy === "reactivate" ? <Loader2 size={15} className="animate-spin" /> : null}{user!.active ? "Deactivate" : "Re-activate"}</Button>}
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={() => run(isNew ? "create" : "save", isNew ? { password } : {})} disabled={!!busy}>
        {(busy === "create" || busy === "save") && <Loader2 size={15} className="animate-spin" />}{isNew ? "Create login" : "Save"}</Button>
    </>}>
      {isOwner ? <div className="text-sm text-ink-2">The owner account always has full access and can’t be changed here.</div> : (
        <div className="space-y-6">
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

          {role !== "admin" && (
            <div>
              <div className="text-xs font-medium text-ink-2 mb-2">Extra permissions</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([k, label]) => (
                  <label key={k} className={cx("flex items-center gap-2.5 rounded-lg border px-3 h-10 text-sm cursor-pointer transition-colors", perms.has(k) ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                    <input type="checkbox" className="accent-[var(--accent)]" checked={perms.has(k)} onChange={() => setPerms(toggle(perms, k))} /> {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {role !== "admin" && (
            <div>
              <div className="text-xs font-medium text-ink-2 mb-2">Owner areas this person can see ({areas.size} selected)</div>
              <div className="rounded-xl border border-line max-h-80 overflow-y-auto divide-y divide-line">
                {tree.map(([community, clusters]) => (
                  <details key={community} className="group">
                    <summary className="flex items-center gap-2.5 px-3 h-10 cursor-pointer text-sm text-ink list-none">
                      <input type="checkbox" className="accent-[var(--accent)]" checked={areas.has(community)} onClick={(e) => e.stopPropagation()} onChange={() => setAreas(toggle(areas, community))} />
                      <span className="flex-1">{community}</span>
                      <span className="text-xs text-ink-3">{clusters.filter((c) => areas.has(`${community}::${c}`)).length || ""}</span>
                    </summary>
                    {!areas.has(community) && (
                      <div className="grid sm:grid-cols-2 gap-x-3 px-9 pb-2">
                        {clusters.map((c) => (
                          <label key={c} className="flex items-center gap-2 h-8 text-sm text-ink-2 cursor-pointer">
                            <input type="checkbox" className="accent-[var(--accent)]" checked={areas.has(`${community}::${c}`)} onChange={() => setAreas(toggle(areas, `${community}::${c}`))} /> {c}
                          </label>
                        ))}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            </div>
          )}

          {!isNew && (
            <div className="rounded-xl border border-line p-4">
              <div className="text-sm font-medium text-ink mb-2">Set a new password</div>
              <div className="flex gap-2">
                <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                <Button onClick={() => run("set_password", { password })} disabled={!!busy || password.length < 8}>Set</Button>
              </div>
            </div>
          )}
          {msg && <div className="text-sm text-good">{msg}</div>}
          {err && <div className="text-sm text-bad">{err}</div>}
        </div>
      )}
    </Sheet>
  );
}
