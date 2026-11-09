"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { initials } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
type BtnSize = "sm" | "md";
/** Button look, also for links that should look like buttons. */
export function buttonClass(variant: BtnVariant = "secondary", size: BtnSize = "md", className?: string) {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[transform,background-color,border-color,color,opacity] duration-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
    variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover btn-primary",
    variant === "secondary" && "bg-surface border border-line hover:border-line-strong hover:bg-surface-2 text-ink",
    variant === "ghost" && "text-ink-2 hover:text-ink hover:bg-surface-2",
    variant === "danger" && "bg-bad text-white hover:opacity-90",
    className,
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", className, ...p }, ref,
) {
  return <button ref={ref} {...p} className={buttonClass(variant, size, className)} />;
});

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("bg-surface border border-line rounded-[20px] shadow-card", className)} />;
}

const TONES = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-text",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

const field = "w-full h-9 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] duration-200 hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/15";
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cx(field, className)} />;
});
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, "pr-8 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238c8c95' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>{children}</select>;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(field, "h-auto min-h-20 py-2 leading-relaxed", className)} />;
}
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton h-4", className)} />;
}

export function Empty({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 animate-in">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="mt-1 text-sm text-ink-3 max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-[28px] font-normal tracking-tight text-ink leading-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

/** Counts up to the number inside `value` ("1,204", "92%"), and ticks to new values when it changes. */
export function CountUp({ value }: { value: string }) {
  const m = value.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
  const target = m ? Number(m[2].replace(/,/g, "")) : NaN;
  const decimals = m?.[2].split(".")[1]?.length ?? 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = target; setShown(target); return; }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 950);
      const v = start + (target - start) * (1 - Math.pow(1 - p, 4));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  if (!m || !Number.isFinite(target)) return <>{value}</>;
  const text = new Intl.NumberFormat("en-AE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(shown);
  return <span className="digits" aria-label={value}>{m[1]}{text}{m[3]}</span>;
}

export function Stat({ label, value, hint, tone, icon, delta, bar }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone;
  icon?: React.ReactNode; delta?: React.ReactNode;
  /** 0 to 1: thin progress line under the number. */
  bar?: number;
}) {
  return (
    <Card className="stat p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="stat-label flex items-center gap-1.5 text-xs font-medium text-ink-2 min-w-0">
          {icon && <span className="text-ink-3 shrink-0">{icon}</span>}<span className="leading-tight lg:truncate">{label}</span>
        </div>
        {delta}
      </div>
      <div className={cx("stat-value mt-3 text-[32px] leading-none font-normal num tracking-tight", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink")}>
        {typeof value === "string" ? <CountUp value={value} /> : value}
      </div>
      {bar != null && (
        <div className="mt-3 h-1 rounded-full bg-surface-2 overflow-hidden">
          <div className="grow-x h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, bar * 100))}%` }} />
        </div>
      )}
      {hint && <div className="mt-2 text-xs text-ink-3">{hint}</div>}
    </Card>
  );
}

/** Slide-over panel from the right (full screen on phones). Stays on screen briefly while it slides away. */
export function Sheet({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };

  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open && !mounted) return null;
  const c = last.current;
  return (
    <div className={cx("fixed inset-0 z-50", !open && "pointer-events-none")}>
      <div className={cx("absolute inset-0 bg-black/35 backdrop-blur-[3px]", open ? "scrim-in" : "scrim-out")} onClick={onClose} />
      <div className={cx(
        "absolute right-0 top-0 h-full w-full bg-surface shadow-pop flex flex-col sm:border-l sm:border-line sm:rounded-l-[26px] overflow-hidden",
        open ? "sheet-in" : "sheet-out",
        wide ? "sm:max-w-2xl" : "sm:max-w-lg",
      )} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-line shrink-0">
          <div className="font-semibold text-ink truncate">{c.title}</div>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{c.children}</div>
        {c.footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">{c.footer}</div>}
      </div>
    </div>
  );
}

/** Pill switch; the highlight slides to the chosen option. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[data-on="1"]');
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={wrap} className="relative inline-flex rounded-full bg-surface-2 p-0.5 border border-line">
      {box && <span className="absolute top-0.5 bottom-0.5 rounded-full bg-surface shadow-card border border-line transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" style={box} />}
      {options.map((o) => (
        <button key={o.value} data-on={value === o.value ? "1" : undefined} onClick={() => onChange(o.value)}
          className={cx("relative h-7 px-3 rounded-full text-[13px] font-medium transition-colors", value === o.value ? "text-ink" : "text-ink-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Dark pill message at the bottom of the screen, with an optional action such as Undo. */
export function Toast({ message, actionLabel, onAction, onClose }: { message: string; actionLabel?: string; onAction?: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div role="status" className="toast fixed left-1/2 bottom-24 lg:bottom-8 z-[60] flex items-center gap-3 rounded-full pl-4 pr-2 h-11 text-[13px] font-medium shadow-pop whitespace-nowrap max-w-[calc(100vw-24px)]">
      <span className="truncate">{message}</span>
      {actionLabel && <button onClick={() => { onAction?.(); onClose(); }} className="font-semibold underline underline-offset-2 px-1 hover:opacity-80">{actionLabel}</button>}
      <button onClick={onClose} aria-label="Dismiss" className="p-1.5 rounded-full opacity-70 hover:opacity-100 transition-opacity"><X size={14} /></button>
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="p-4 space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4"><Skeleton className="w-40" /><Skeleton className="w-20" /><Skeleton className="flex-1" /><Skeleton className="w-24" /></div>
      ))}
    </Card>
  );
}
