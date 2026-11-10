"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Button, Sheet, cx } from "@/components/ui";

export type ColumnDef<K extends string> = { key: K; label: string; on: boolean; locked?: boolean };
type Saved<K> = { order: K[]; shown: K[] };

/**
 * Which table columns show, and in what order, saved on this device under `storageKey`.
 * `legacyKey` reads the older format (a plain array of shown keys) once.
 */
export function useColumnPrefs<K extends string>(storageKey: string, all: readonly ColumnDef<K>[], legacyKey?: string) {
  const defaults = useMemo<Saved<K>>(() => ({ order: all.map((c) => c.key), shown: all.filter((c) => c.on || c.locked).map((c) => c.key) }), [all]);
  const [prefs, setPrefs] = useState<Saved<K>>(defaults);

  useEffect(() => {
    const valid = new Set(all.map((c) => c.key));
    let saved: Partial<Saved<K>> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved && legacyKey) {
        const old = JSON.parse(localStorage.getItem(legacyKey) || "null");
        if (Array.isArray(old)) saved = { shown: old };
      }
    } catch { saved = null; }
    if (!saved) { setPrefs(defaults); return; }
    // Keep saved order, drop unknown keys, add any new columns at the end.
    const order = (saved.order || defaults.order).filter((k) => valid.has(k));
    for (const k of defaults.order) if (!order.includes(k)) order.push(k);
    const shown = (saved.shown || defaults.shown).filter((k) => valid.has(k));
    for (const c of all) if (c.locked && !shown.includes(c.key)) shown.push(c.key);
    setPrefs({ order, shown });
  }, [storageKey, legacyKey, all, defaults]);

  const save = (next: Saved<K>) => {
    setPrefs(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  const byKey = useMemo(() => new Map(all.map((c) => [c.key, c])), [all]);
  const ordered = prefs.order.map((k) => byKey.get(k)!).filter(Boolean);
  const shown = new Set(prefs.shown);

  return {
    /** Every column, in the person's order. */
    ordered,
    shown,
    /** Shown columns, in order: render the table from this. */
    visible: ordered.filter((c) => shown.has(c.key)),
    toggle: (k: K) => {
      if (byKey.get(k)?.locked) return;
      save({ ...prefs, shown: shown.has(k) ? prefs.shown.filter((x) => x !== k) : [...prefs.shown, k] });
    },
    move: (from: number, to: number) => {
      if (to < 0 || to >= prefs.order.length || from === to) return;
      const order = [...prefs.order];
      const [k] = order.splice(from, 1);
      order.splice(to, 0, k);
      save({ ...prefs, order });
    },
    reset: () => save(defaults),
  };
}

/** Tick columns on/off and drag them (or use the arrows) into order. The table behind updates as you go. */
export function ColumnPickerSheet<K extends string>({ open, onClose, prefs, hide }: {
  open: boolean;
  onClose: () => void;
  prefs: ReturnType<typeof useColumnPrefs<K>>;
  /** Columns this person may not use (e.g. Agent for non-admins). */
  hide?: (k: K) => boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const items = prefs.ordered.map((c, i) => ({ c, i })).filter(({ c }) => !hide?.(c.key));

  return (
    <Sheet open={open} onClose={onClose} title="Columns" footer={<>
      <Button variant="ghost" className="mr-auto" onClick={prefs.reset}>Reset</Button>
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
      <div className="text-sm text-ink-2 mb-3">Tick the columns to show. Drag <GripVertical size={13} className="inline -mt-0.5" /> or use the arrows to change the order. Saved on this device.</div>
      <ul className="space-y-1.5">
        {items.map(({ c, i }, pos) => {
          const on = prefs.shown.has(c.key);
          return (
            <li key={c.key}
              draggable
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i); }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) prefs.move(drag, i); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              className={cx("flex items-center gap-2 rounded-lg border pl-1.5 pr-1 h-11 text-sm transition-colors",
                on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2",
                drag === i && "opacity-40",
                over === i && drag !== null && drag !== i && "ring-2 ring-accent")}>
              <span className="cursor-grab active:cursor-grabbing p-1 text-ink-3" aria-hidden><GripVertical size={16} /></span>
              <label className="flex flex-1 items-center gap-2.5 cursor-pointer min-w-0">
                <input type="checkbox" className="accent-[var(--accent)]" checked={on} disabled={c.locked} onChange={() => prefs.toggle(c.key)} />
                <span className="truncate">{c.label}</span>
                {c.locked && <span className="text-xs text-ink-3">(always shown)</span>}
              </label>
              <button type="button" className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 disabled:opacity-30" disabled={pos === 0}
                onClick={() => prefs.move(i, items[pos - 1].i)} aria-label={`Move ${c.label} up`}><ChevronUp size={16} /></button>
              <button type="button" className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 disabled:opacity-30" disabled={pos === items.length - 1}
                onClick={() => prefs.move(i, items[pos + 1].i)} aria-label={`Move ${c.label} down`}><ChevronDown size={16} /></button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
