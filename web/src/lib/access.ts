// Who can see what. The database enforces this (Row Level Security); the app uses the same rules only
// to decide which menu items and buttons to show.

export const SUPER_ADMIN_EMAIL = "thechussar@gmail.com";

export type Role = "super_admin" | "admin" | "team_leader" | "agent" | "accounts" | "hr";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  team_leader: "Team Leader",
  agent: "Agent",
  accounts: "Accounts",
  hr: "Admin / HR / Operations",
};

/** Extra ticks that can be given to any person on top of their role. */
export const PERMISSIONS = {
  compliance: "Compliance officer",
  approve_deals: "Approve deals",
  approve_expenses: "Approve expenses & advances",
  approve_leave: "Approve leave",
  approve_listings: "Approve listings",
  view_finance: "See all money figures",
  manage_users: "Manage users",
  export: "Export data",
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  super_admin: Object.keys(PERMISSIONS) as Permission[],
  admin: Object.keys(PERMISSIONS) as Permission[],
  team_leader: ["approve_listings", "approve_leave"],
  agent: [],
  accounts: ["approve_deals", "approve_expenses", "view_finance", "export"],
  hr: ["approve_leave", "manage_users"],
};

export type AccessRow = {
  id?: string;
  email: string;
  name: string | null;
  role: string | null;
  active: boolean | null;
  permissions?: string[] | null;
  assigned_communities?: string[] | null;
  assigned_clusters?: string[] | null;
};

export type Me = {
  email: string;
  name: string;
  role: Role;
  permissions: Set<Permission>;
  isSuperAdmin: boolean;
  isAdmin: boolean;
};

export function resolveMe(email: string, row: AccessRow | null): Me {
  const lower = email.toLowerCase();
  const isSuperAdmin = lower === SUPER_ADMIN_EMAIL;
  const raw = (row?.role || "agent").toLowerCase().replace(/[\s/-]+/g, "_");
  const role: Role = isSuperAdmin ? "super_admin" : (raw in ROLE_LABEL ? (raw as Role) : "agent");
  const perms = new Set<Permission>(ROLE_DEFAULTS[role]);
  for (const p of row?.permissions || []) if (p in PERMISSIONS) perms.add(p as Permission);
  return {
    email: lower,
    name: row?.name || (isSuperAdmin ? "Usama" : lower.split("@")[0]),
    role,
    permissions: perms,
    isSuperAdmin,
    isAdmin: isSuperAdmin || role === "admin",
  };
}

export function can(me: Me | null, p: Permission): boolean {
  return !!me && (me.isAdmin || me.permissions.has(p));
}
