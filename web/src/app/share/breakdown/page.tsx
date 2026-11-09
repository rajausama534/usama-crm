import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientBreakdown } from "./ClientBreakdown";

export const metadata: Metadata = { title: "Property Breakdown", robots: { index: false, follow: false } };

// Public page, no login. The old CRM's client links (/breakdown.html?d=… and /breakdown?d=…) are sent here by next.config.ts.
export default function Page() {
  return <Suspense><ClientBreakdown /></Suspense>;
}
