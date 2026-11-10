import {
  LayoutDashboard, Inbox, CalendarDays, Users2, Home, Megaphone, Handshake,
  Landmark, BadgeCheck, ShieldCheck, Settings, MessageCircle, FileText, Building2, UserSearch, Map, BarChart3, Sparkles, ClipboardList, type LucideIcon,
} from "lucide-react";
import { canUseSales, type Me } from "@/lib/access";

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
      { href: "/bunty", label: "Bunty", icon: Sparkles, show: (me) => me.isSuperAdmin },
      { href: "/approvals", label: "Approvals", icon: Inbox },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, show: canUseSales },
      { href: "/my", label: "My requests", icon: ClipboardList },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/leads", label: "Leads", icon: Users2, show: canUseSales },
      { href: "/owners", label: "Owners", icon: Home, show: canUseSales },
      { href: "/deals", label: "Deals", icon: Handshake, show: canUseSales },
      { href: "/listings", label: "Listings", icon: Megaphone, show: canUseSales },
      { href: "/broadcast", label: "WhatsApp Broadcast", icon: MessageCircle, show: (me) => me.isAdmin },
      { href: "/breakdown", label: "Breakdown", icon: FileText, show: canUseSales },
    ],
  },
  {
    title: "Market Data",
    items: [
      { href: "/unit-finder", label: "Unit Finder", icon: Building2, show: canUseSales },
      { href: "/market/owner-finder", label: "Owner Finder", icon: UserSearch, show: canUseSales },
      { href: "/market/cluster-guide", label: "Cluster Guide", icon: Map, show: canUseSales },
      { href: "/market/cluster-data", label: "Cluster Data", icon: BarChart3, show: canUseSales },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark, show: finance },
      { href: "/hr", label: "HR", icon: BadgeCheck, show: hr },
      { href: "/compliance", label: "Compliance", icon: ShieldCheck, show: compliance },
    ],
  },
  {
    title: "Admin",
    items: [{ href: "/settings/users", label: "Users & access", icon: Settings, show: (me) => me.isAdmin || me.permissions.has("manage_users") }],
  },
];

/** False when this page belongs to a department the person does not have (so a typed-in link is sent home). */
export function canOpen(me: Me, pathname: string) {
  const items = NAV.flatMap((s) => s.items).filter((i) => i.href !== "/");
  const match = items.filter((i) => pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return !match || !match.show || match.show(me);
}

export function visibleNav(me: Me): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.show || i.show(me)) })).filter((s) => s.items.length);
}
