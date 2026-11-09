"use client";

// While the portal is open: a pop-up (plus a desktop notification and a short sound) at the chosen reminder time, and a
// "log it" prompt once the meeting time has passed and it is still open. Same rules and saved state as the old CRM.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Button } from "@/components/ui";
import { fmtTime } from "@/lib/format";

const ALERT_KEY = "crm_event_alerts_v1";
/** Bunty's Hush button: no pop-ups or sound until this time. */
export const HUSH_KEY = "crm_hush_until";
const DAY = 864e5;
type Ev = { id: string; event_type: string; title: string; starts_at: string; ends_at: string | null; remind_minutes: number | null; lead_id: string | null; leads: { name: string | null } | null };
type Alert = { e: Ev; kind: "remind" | "log"; key: string; head: string; who: string };

const readState = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(ALERT_KEY) || "{}"); } catch { return {}; } };
const writeState = (s: Record<string, number>) => { try { localStorage.setItem(ALERT_KEY, JSON.stringify(s)); } catch {} };

function beep() {
  try {
    const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const c = new (W.AudioContext || W.webkitAudioContext!)();
    [0, 0.25].forEach((t) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.2);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2);
    });
  } catch {}
}

export function Reminders() {
  const { me } = useAuth();
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const shown = useRef(new Set<string>());

  const check = useCallback(async () => {
    if (!me) return;
    const now = Date.now();
    try { if (Number(localStorage.getItem(HUSH_KEY) || 0) > now) return; } catch {}
    const { data } = await db.from("crm_events").select("*,leads(name)").eq("status", "Scheduled").ilike("assigned_to", me.email)
      .gte("starts_at", new Date(now - 12 * 3600e3).toISOString()).lte("starts_at", new Date(now + 25 * 3600e3).toISOString()).order("starts_at");
    const st = readState();
    for (const k of Object.keys(st)) if (st[k] < now - 2 * DAY) delete st[k];
    const fresh: Alert[] = [];
    const show = (e: Ev, kind: Alert["kind"]) => {
      const key = `${e.id}|${kind}|${e.starts_at}`;
      if (shown.current.has(key)) return;
      shown.current.add(key);
      st[key] = now + 365 * DAY;
      const mins = Math.round((new Date(e.starts_at).getTime() - now) / 60000);
      const who = e.leads?.name || e.title;
      const head = kind === "remind" ? (mins > 0 ? `${e.event_type} in ${mins >= 60 ? Math.round(mins / 60) + " h" : mins + " min"}` : `${e.event_type} now`) : `Log your ${e.event_type.toLowerCase()}`;
      fresh.push({ e, kind, key, head, who });
      if ("Notification" in window && Notification.permission === "granted") {
        try { const n = new Notification(head, { body: `${who} · ${fmtTime(e.starts_at)}`, tag: key }); n.onclick = () => { window.focus(); n.close(); }; } catch {}
      }
    };
    for (const e of (data || []) as Ev[]) {
      const start = new Date(e.starts_at).getTime(), end = e.ends_at ? new Date(e.ends_at).getTime() : start + 30 * 60000;
      const due = (kind: string, ok: boolean) => ok && !(st[`${e.id}|${kind}|${e.starts_at}`] > now);
      if (due("remind", now >= start - (e.remind_minutes || 0) * 60000 && now < start + 15 * 60000)) show(e, "remind");
      else if (due("log", now >= end)) show(e, "log");
    }
    writeState(st);
    if (fresh.length) { setAlerts((a) => [...a, ...fresh]); beep(); }
  }, [me]);

  useEffect(() => {
    check().catch(() => {});
    const t = setInterval(() => check().catch(() => {}), 30000);
    const onChange = () => check().catch(() => {});
    window.addEventListener("crm:events-changed", onChange);
    return () => { clearInterval(t); window.removeEventListener("crm:events-changed", onChange); };
  }, [check]);

  // Desktop notifications need a click to be allowed.
  useEffect(() => {
    const ask = () => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); };
    window.addEventListener("pointerdown", ask, { once: true });
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  const close = (key: string) => setAlerts((a) => a.filter((x) => x.key !== key));
  function go(a: Alert, complete: boolean) {
    close(a.key);
    if (location.pathname === "/calendar") window.dispatchEvent(new CustomEvent("crm:open-event", { detail: { id: a.e.id, complete } }));
    else router.push(`/calendar?${complete ? "complete" : "edit"}=${a.e.id}`);
  }
  function snooze(a: Alert) {
    const s = readState();
    s[a.key] = Date.now() + 10 * 60000;
    writeState(s); shown.current.delete(a.key); close(a.key);
  }

  if (!alerts.length) return null;
  return (
    <div className="fixed z-[55] right-3 left-3 sm:left-auto sm:right-5 bottom-24 lg:bottom-5 sm:w-[340px] space-y-2">
      {alerts.map((a) => (
        <div key={a.key} role="alert" className="toast-in rounded-2xl bg-surface border border-line shadow-pop p-3.5 animate-in">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid place-items-center size-7 rounded-full bg-accent-soft text-accent-text shrink-0"><Bell size={14} /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">{a.head}</div>
              <div className="text-[13px] text-ink-2 truncate">{a.who} · {fmtTime(a.e.starts_at)}</div>
            </div>
            <button aria-label="Dismiss" className="p-1 -mr-1 -mt-1 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2" onClick={() => close(a.key)}><X size={15} /></button>
          </div>
          <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => snooze(a)}>Snooze 10 min</Button>
            <Button size="sm" onClick={() => go(a, false)}>Open</Button>
            {a.kind === "log" && <Button size="sm" variant="primary" onClick={() => go(a, true)}>Log / Done</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}
