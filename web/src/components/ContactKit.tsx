"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Check, Copy, Phone } from "lucide-react";
import { useAuth } from "@/components/Providers";
import { Button, Field, Input, Sheet, Textarea } from "@/components/ui";
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
const WA_PATH = "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z";
/** Small round button in the WhatsApp logo shape. */
export function WaButton({ phone, text, onContact }: { phone: string | null | undefined; text: string; onContact?: () => void }) {
  const f = formatPhone(phone);
  if (!f) return <span className="text-ink-3">—</span>;
  return (
    <a href={`https://wa.me/${f}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp" onClick={(e) => { e.stopPropagation(); onContact?.(); }}
      className="inline-flex shrink-0 items-center justify-center size-8 rounded-full bg-[#25d366] text-white hover:opacity-90 transition-opacity">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d={WA_PATH} /></svg>
    </a>
  );
}
export function CallButton({ phone, onContact }: { phone: string | null | undefined; onContact?: () => void }) {
  const f = formatPhone(phone);
  if (!f) return null;
  return (
    <a href={`tel:+${f}`} title="Call" aria-label="Call" onClick={(e) => { e.stopPropagation(); onContact?.(); }}
      className="inline-flex shrink-0 items-center justify-center size-8 rounded-full bg-call text-white hover:opacity-90 transition-opacity">
      <Phone size={14} />
    </a>
  );
}
export function CopyButton({ value }: { value: string | null | undefined }) {
  const toast = useToast();
  if (!value) return null;
  return (
    <button onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(value); toast("Copied"); } catch { toast("Copy failed"); } }}
      className="inline-flex shrink-0 items-center justify-center size-8 rounded-full border border-line bg-surface text-ink-2 hover:text-ink hover:border-line-strong"
      title={`Copy ${value}`} aria-label={`Copy ${value}`}>
      <Copy size={14} />
    </button>
  );
}
