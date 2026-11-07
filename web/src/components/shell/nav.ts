import {
  LayoutDashboard, Inbox, CalendarDays, Users2, Home, Megaphone, Handshake,
  Landmark, BadgeCheck, ShieldCheck, Settings, type LucideIcon,
} from "lucide-react";
import type { Me } from "@/lib/access";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Step in the build order when this arrives; shown as "Soon" until then. */
  soon?: string;
  show?: (me: Me) => boolean;
};
export type NavSection = { title?: string; items: NavItem[] };

const finance = (me: Me) => me.isAdmin || me.role === "accounts" || me.permissions.has("view_finance");
const hr = (me: Me) => me.isAdmin || me.role === "hr";
const compliance = (me: Me) => me.isAdmin || me.permissions.has("compliance");

export const NAV: NavSection[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/approvals", label: "Approvals", icon: Inbox },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/leads", label: "Leads", icon: Users2 },
      { href: "/owners", label: "Owners", icon: Home },
      { href: "/deals", label: "Deals", icon: Handshake, soon: "Step 2" },
      { href: "/listings", label: "Listings", icon: Megaphone, soon: "Step 5" },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark, soon: "Step 3", show: finance },
      { href: "/hr", label: "HR", icon: BadgeCheck, soon: "Step 4", show: hr },
      { href: "/compliance", label: "Compliance", icon: ShieldCheck, soon: "Step 2", show: compliance },
    ],
  },
  {
    title: "Admin",
    items: [{ href: "/settings/users", label: "Users & access", icon: Settings, show: (me) => me.isAdmin || me.permissions.has("manage_users") }],
  },
];

export function visibleNav(me: Me): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.show || i.show(me)) })).filter((s) => s.items.length);
}
