"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Check, Copy, MessageCircle, Phone } from "lucide-react";
import { useAuth } from "@/components/Providers";
import { Button, Field, Input, Sheet, Textarea, cx } from "@/components/ui";
import { DEFAULT_TEMPLATE, formatPhone, getTemplate, intro, saveTemplate, type WaTemplate } from "@/lib/contact";

/* ---------------------------------------------------------------- toast ("Saved") */
const ToastCtx = createContext<(msg?: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m = "Saved") => { setMsg(m); setTimeout(() => setMsg(null), 1400); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] inline-flex items-center gap-2 rounded-full bg-ink text-bg px-4 h-10 text-sm font-medium shadow-pop animate-in">
          <Check size={15} /> {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* ---------------------------------------------------------------- WhatsApp template (per browser, same key as old CRM) */
export function useWaTemplate() {
  const { me } = useAuth();
  const [t, setT] = useState<WaTemplate>(DEFAULT_TEMPLATE);
  useEffect(() => {
    const load = () => setT(getTemplate(me?.name, me?.isAdmin));
    load();
    window.addEventListener("wa-template", load);
    return () => window.removeEventListener("wa-template", load);
  }, [me]);
  return t;
}

export function TemplateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useWaTemplate();
  const { me } = useAuth();
  const toast = useToast();
  const [t, setT] = useState(current);
  useEffect(() => { if (open) setT(current); }, [open, current]);
  const set = (k: keyof WaTemplate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT({ ...t, [k]: e.target.value });
  const preview = `${t.greeting || "Hello"} Mr. Owner Name,\n\n${intro(t)}\n\nI'm reaching out regarding your property in Cluster/Tower, Unit #101, Community.\n\n${t.message}\n\nRegards,\n${t.agentName}`;
  return (
    <Sheet open={open} onClose={onClose} title="WhatsApp message" footer={<>
      <Button variant="ghost" className="mr-auto" onClick={() => setT({ ...DEFAULT_TEMPLATE, agentName: me?.name || DEFAULT_TEMPLATE.agentName, title: me?.isAdmin ? DEFAULT_TEMPLATE.title : "" })}>Reset</Button>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={() => { saveTemplate(t); window.dispatchEvent(new Event("wa-template")); toast(); onClose(); }}>Save template</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Greeting"><Input value={t.greeting} onChange={set("greeting")} /></Field>
          <Field label="Your name"><Input value={t.agentName} onChange={set("agentName")} /></Field>
          <Field label="Title"><Input value={t.title} onChange={set("title")} /></Field>
          <Field label="Company"><Input value={t.company} onChange={set("company")} /></Field>
        </div>
        <Field label="Message"><Textarea rows={3} value={t.message} onChange={set("message")} /></Field>
        <div>
          <div className="text-xs font-medium text-ink-2 mb-1.5">Preview</div>
          <div className="rounded-xl bg-surface-2 p-3.5 text-sm text-ink whitespace-pre-wrap">{preview}</div>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- buttons */
export function WaButton({ phone, text, onContact, compact }: { phone: string | null | undefined; text: string; onContact?: () => void; compact?: boolean }) {
  const f = formatPhone(phone);
  if (!f) return <span className="text-ink-3">—</span>;
  return (
    <a href={`https://wa.me/${f}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); onContact?.(); }}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg bg-wa text-white font-medium hover:opacity-90 transition-opacity", compact ? "h-8 w-8" : "h-8 px-3 text-[13px]")}>
      <MessageCircle size={15} />{!compact && "WhatsApp"}
    </a>
  );
}
export function CallButton({ phone, onContact, compact }: { phone: string | null | undefined; onContact?: () => void; compact?: boolean }) {
  const f = formatPhone(phone);
  if (!f) return null;
  return (
    <a href={`tel:+${f}`} onClick={(e) => { e.stopPropagation(); onContact?.(); }}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg bg-call text-white font-medium hover:opacity-90 transition-opacity", compact ? "h-8 w-8" : "h-8 px-3 text-[13px]")}>
      <Phone size={14} />{!compact && "Call"}
    </a>
  );
}
export function CopyButton({ value, compact }: { value: string | null | undefined; compact?: boolean }) {
  const toast = useToast();
  if (!value) return null;
  return (
    <button onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(value); toast("Copied"); } catch { toast("Copy failed"); } }}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-ink-2 hover:text-ink hover:border-line-strong font-medium", compact ? "h-8 w-8" : "h-8 px-3 text-[13px]")}
      title={`Copy ${value}`}>
      <Copy size={14} />{!compact && "Copy"}
    </button>
  );
}
