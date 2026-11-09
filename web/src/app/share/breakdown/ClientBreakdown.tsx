"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BreakdownDoc } from "@/components/breakdown/BreakdownDoc";
import { buildPdf, decode, pdfName, saveBlob, type Breakdown } from "@/lib/breakdown";

// Read-only client view: everything comes from the link itself, nothing is loaded from the CRM.
export function ClientBreakdown() {
  const params = useSearchParams();
  const [state, setState] = useState<{ d?: Breakdown; bad?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      const d = decode(params.get("d") || params.get("data"));
      setState({ d });
      document.title = (d.title || "Property") + (d.subtitle ? ` · ${d.subtitle}` : "");
    } catch { setState({ bad: true }); }
  }, [params]);

  async function pdf() {
    if (!state.d) return;
    setBusy(true); setFailed(false);
    try { saveBlob(await buildPdf(state.d), pdfName(state.d)); } catch { setFailed(true); }
    setBusy(false);
  }

  return (
    <div className="min-h-dvh bg-[#eef2f7] sm:px-4 sm:py-7 print:bg-white print:p-0" style={{ colorScheme: "light" }}>
      {state.bad ? (
        <p className="max-w-[520px] mx-auto pt-16 px-6 text-center text-[15px] text-[#334155]">This breakdown link is incomplete. Please ask your agent to send it again.</p>
      ) : state.d ? (
        <>
          <div className="max-w-[820px] mx-auto mb-3 flex items-center justify-end gap-3 px-3 pt-2.5 sm:p-0 print:hidden">
            {failed && <span className="text-[13px] text-[#b42318]">The PDF could not be made. Please try again.</span>}
            <button onClick={pdf} disabled={busy} className="h-10 px-4 rounded-[9px] border border-[#cbd5e1] bg-white text-[13px] font-semibold text-[#0f172a] disabled:opacity-60">{busy ? "Making PDF…" : "Download PDF"}</button>
          </div>
          <BreakdownDoc data={state.d} />
        </>
      ) : null}
    </div>
  );
}
