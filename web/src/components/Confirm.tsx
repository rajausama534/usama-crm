"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

type Ask = { title: string; hint?: string; yes?: string; danger?: boolean };

/** `const [ask, node] = useConfirm()`: `await ask({title})` is true when the person presses the main button. */
export function useConfirm() {
  const [q, setQ] = useState<Ask | null>(null);
  const done = useRef<(v: boolean) => void>(() => {});
  const ask = useCallback((a: Ask) => new Promise<boolean>((res) => { done.current = res; setQ(a); }), []);
  const answer = useCallback((v: boolean) => { done.current(v); setQ(null); }, []);
  useEffect(() => {
    if (!q) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, answer]);
  const node = q && (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[3px] scrim-in" onClick={() => answer(false)} />
      <div className="relative w-full max-w-sm rounded-[20px] bg-surface border border-line shadow-pop p-5 animate-in">
        <div className="font-semibold text-ink">{q.title}</div>
        {q.hint && <div className="mt-1 text-sm text-ink-2">{q.hint}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(false)}>Cancel</Button>
          <Button variant={q.danger ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>{q.yes || "Yes"}</Button>
        </div>
      </div>
    </div>
  );
  return [ask, node] as const;
}
