"use client";

// Bunty's screen: department tabs with pending counts, the approved particle-sphere core, the conversation, and call-style
// voice controls. Usama only for now: the menu item is hidden from everyone else and /api/bunty refuses them too.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Bell, BellOff, Briefcase, CalendarCheck, CircleDollarSign, FileText, Landmark, ListChecks, Loader2, Megaphone,
  Mic, Percent, SendHorizontal, ShieldCheck, Users2, Volume2, VolumeX, CheckSquare, type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Button, Card, Skeleton, cx } from "@/components/ui";
import { fmtTime, todayDubai } from "@/lib/format";
import { HUSH_KEY } from "@/components/shell/Reminders";

type Dept = { key: string; name: string; soon?: string };
type Pending = { count: number; title: string; items: { text: string; tone: "bad" | "warn" | "info" | "good" }[]; actions?: string[] };
type ConfirmCard = { id: string; tool: string; card: { title: string; lines: string[]; danger?: boolean } };
type Msg = { role: "user" | "bunty"; text: string; tools?: string[] };
type Mode = "idle" | "listening" | "thinking" | "working";

const ICONS: Record<string, LucideIcon> = { overview: BarChart3, sales: Briefcase, commission: CircleDollarSign, accounts: Landmark, vat: Percent, hr: Users2, documents: FileText, compliance: ShieldCheck, listings: Megaphone, approvals: CheckSquare, tasks: CalendarCheck };
const DOT: Record<string, string> = { bad: "bg-bad", warn: "bg-gold", info: "bg-accent", good: "bg-good" };
const MUTE_KEY = "bunty_muted";
const STATE: Record<Mode, string> = { idle: "Ready", listening: "Listening…", thinking: "Thinking…", working: "Working…" };

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await db.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

/** Bold and internal links only: replies come from Claude, so nothing else in them is treated as formatting. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const inline = (s: string, k: number) => s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(\/[^)\s]*\))/g).map((p, i) => {
    const b = p.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <b key={`${k}-${i}`} className="font-semibold">{b[1]}</b>;
    const a = p.match(/^\[([^\]]+)\]\((\/[^)\s]*)\)$/);
    if (a && !a[2].startsWith("//")) return <Link key={`${k}-${i}`} href={a[2]} className="underline text-accent-text">{a[1]}</Link>;
    return <span key={`${k}-${i}`}>{p}</span>;
  });
  return <>{lines.map((l, i) => {
    const li = l.match(/^\s*[-•*]\s+(.*)$/);
    if (li) return <div key={i} className="flex gap-2 mt-1"><span className="mt-[9px] size-1.5 rounded-full bg-accent shrink-0" /><div>{inline(li[1], i)}</div></div>;
    return l.trim() ? <div key={i} className={i ? "mt-1.5" : ""}>{inline(l, i)}</div> : null;
  })}</>;
}

function hexToRgb(h: string): [number, number, number] {
  const m = h.trim().replace("#", "");
  return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0];
}

/** The approved look: a slowly turning sphere of particles that swells when Bunty listens or thinks. */
function Core({ mode, muted }: { mode: Mode; muted: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, muted });
  live.current = { mode, muted };
  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d")!;
    const N = 420, pts: [number, number, number][] = [];
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.39996; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
    let W = 0, H = 0, raf = 0, amp = 0, back: [number, number, number] = [0, 0, 0], front: [number, number, number] = [0, 0, 0];
    const size = () => { const r = cv.getBoundingClientRect(), p = devicePixelRatio || 1; cv.width = r.width * p; cv.height = r.height * p; W = cv.width; H = cv.height; };
    const colours = () => { const s = getComputedStyle(document.documentElement); back = hexToRgb(s.getPropertyValue("--orb-1")); front = hexToRgb(s.getPropertyValue("--orb-2")); };
    size(); colours();
    window.addEventListener("resize", size);
    const obs = new MutationObserver(colours);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000, { mode: m, muted: mu } = live.current;
      const target = m === "listening" ? 1 : m === "thinking" || m === "working" ? 0.55 : 0.15;
      amp = lerp(amp, mu && m === "idle" ? 0.05 : target, 0.06);
      g.clearRect(0, 0, W, H);
      const cx0 = W / 2, cy0 = H / 2, S = Math.min(W, H), R0 = S * 0.36 * (1 + amp * 0.06 * Math.sin(t * 6));
      const ry = t * 0.35 + (m === "thinking" || m === "working" ? t * 0.8 : 0), rx = 0.35;
      const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
      for (const p of pts) {
        const x = p[0] * cY - p[2] * sY; let z = p[0] * sY + p[2] * cY; const y = p[1] * cX - z * sX; z = p[1] * sX + z * cX;
        const wob = 1 + amp * 0.08 * Math.sin(p[1] * 8 + t * 7), k = (z + 1) / 2, r = (0.6 + k * 1.6) * (S / 300);
        g.fillStyle = `rgba(${Math.round(lerp(back[0], front[0], k))},${Math.round(lerp(back[1], front[1], k))},${Math.round(lerp(back[2], front[2], k))},${0.18 + k * 0.75})`;
        g.beginPath(); g.arc(cx0 + x * R0 * wob, cy0 + y * R0 * wob, r, 0, 7); g.fill();
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); obs.disconnect(); };
  }, []);
  return <canvas ref={ref} className="block size-[200px] sm:size-[260px]" aria-hidden />;
}

export default function BuntyPage() {
  const { me, session } = useAuth();
  const router = useRouter();
  const allowed = !!me?.isSuperAdmin;
  useEffect(() => { if (me && !allowed) router.replace("/"); }, [me, allowed, router]);

  const pending = useQuery({
    queryKey: ["bunty-pending"], enabled: allowed && !!session, staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch("/api/bunty/pending", { headers: await authHeader() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load");
      return j as { departments: Dept[]; pending: Record<string, Pending | null>; ai: boolean };
    },
  });
  const stats = useQuery({ queryKey: ["dashboard-stats"], enabled: allowed, queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as any });
  const today = useQuery({
    queryKey: ["bunty-today"], enabled: allowed,
    queryFn: async () => {
      const d = todayDubai();
      const { data } = await db.from("crm_events").select("id,event_type,title,starts_at,status").gte("starts_at", `${d}T00:00:00+04:00`).lte("starts_at", `${d}T23:59:59+04:00`).order("starts_at").limit(8);
      return (data || []) as { id: string; event_type: string; title: string; starts_at: string; status: string }[];
    },
  });

  const [dept, setDept] = useState("overview");
  const [mode, setMode] = useState<Mode>("idle");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [cards, setCards] = useState<ConfirmCard[]>([]);
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [muted, setMuted] = useState(false);
  const [hushUntil, setHushUntil] = useState(0);
  const [hasMic, setHasMic] = useState(false);
  const history = useRef<any[]>([]);
  const pendingResults = useRef<unknown>(null);
  const recog = useRef<any>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = mode === "thinking" || mode === "working";

  useEffect(() => {
    try { setMuted(localStorage.getItem(MUTE_KEY) === "1"); setHushUntil(Number(localStorage.getItem(HUSH_KEY) || 0)); } catch {}
    setHasMic(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    return () => { try { window.speechSynthesis?.cancel(); recog.current?.abort(); } catch {} };
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, cards]);

  const speak = useCallback((text: string) => {
    if (muted || !("speechSynthesis" in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_#`]/g, "");
    const u = new SpeechSynthesisUtterance(clean);
    if (/[؀-ۿ]/.test(clean)) u.lang = "ur-PK";
    window.speechSynthesis.speak(u);
  }, [muted]);

  const stream = useCallback(async (body: Record<string, unknown>) => {
    setErr(""); setMode("thinking");
    let reply = "";
    setMsgs((m) => [...m, { role: "bunty", text: "", tools: [] }]);
    const patch = (fn: (x: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);
    try {
      const r = await fetch("/api/bunty", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Bunty could not answer."); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "state") setMode(ev.s === "working" ? "working" : "thinking");
          else if (ev.t === "text") { reply += ev.d; patch((x) => ({ ...x, text: x.text + ev.d })); }
          else if (ev.t === "tool") patch((x) => ({ ...x, tools: [...(x.tools || []), ev.label] }));
          else if (ev.t === "confirm") { history.current = ev.history; pendingResults.current = ev.pending; setCards(ev.cards); setChoice({}); }
          else if (ev.t === "done") history.current = ev.history;
          else if (ev.t === "error") throw new Error(ev.message);
        }
      }
      speak(reply);
    } catch (e) { setErr((e as Error).message); }
    setMsgs((m) => (m[m.length - 1]?.role === "bunty" && !m[m.length - 1].text && !m[m.length - 1].tools?.length ? m.slice(0, -1) : m));
    setMode("idle");
    pending.refetch();
  }, [speak, pending]);

  const ask = useCallback((text: string) => {
    const t = text.trim();
    if (!t || busy || cards.length) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    stream({ history: history.current, message: t });
  }, [busy, cards.length, stream]);

  function decide() {
    const decisions = Object.fromEntries(cards.map((c) => [c.id, choice[c.id] === true]));
    setCards([]);
    stream({ history: history.current, pending: pendingResults.current, decisions });
  }

  function mic() {
    if (mode === "listening") { recog.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    window.speechSynthesis?.cancel();
    const r = new SR();
    r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = false;
    let final = "";
    r.onresult = (e: any) => { let live = ""; for (const x of e.results) { if (x.isFinal) final = x[0].transcript; else live += x[0].transcript; } setInput(final || live); };
    r.onerror = (e: any) => { if (e.error !== "aborted" && e.error !== "no-speech") setErr("The microphone could not start. Allow it for this site and try again."); };
    r.onend = () => { setMode("idle"); if (final.trim()) ask(final); };
    recog.current = r;
    setMode("listening");
    r.start();
  }
  function toggleMute() {
    const v = !muted; setMuted(v);
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch {}
    if (v) window.speechSynthesis?.cancel();
  }
  function toggleHush() {
    const until = hushUntil > Date.now() ? 0 : Date.now() + 3600e3;
    setHushUntil(until);
    try { localStorage.setItem(HUSH_KEY, String(until)); } catch {}
  }
  const hushed = hushUntil > Date.now();

  const hello = useMemo(() => {
    const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dubai" }).format(new Date()));
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }, []);

  if (!allowed) return <div className="grid place-items-center py-24"><div className="orb" /></div>;
  const departments = pending.data?.departments || [];
  const summary = pending.data?.pending?.[dept];
  const active = departments.find((d) => d.key === dept);
  const kpis: [string, number | undefined, boolean?][] = [
    ["New leads · 7 days", stats.data?.leads?.new_7d], ["Follow-ups today", stats.data?.leads?.followups_today], ["Overdue follow-ups", stats.data?.leads?.followups_overdue, true], ["Owners contacted · 7 days", stats.data?.owners?.contacted_7d],
  ];

  return (
    <div className="animate-in pb-24">
      <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)_270px] items-start">
        {/* Departments */}
        <Card className="p-2 xl:p-3 xl:sticky xl:top-20 flex xl:block gap-1 overflow-x-auto [scrollbar-width:none]">
          <div className="hidden xl:block px-2 mb-2 text-xs font-medium text-ink-2">Departments</div>
          {pending.isLoading && <div className="p-2 space-y-3 w-full"><Skeleton /><Skeleton /><Skeleton /></div>}
          {departments.map((d) => {
            const Icon = ICONS[d.key] || ListChecks, n = pending.data?.pending?.[d.key]?.count || 0, on = dept === d.key;
            return (
              <button key={d.key} onClick={() => setDept(d.key)} className={cx("relative shrink-0 flex flex-col xl:flex-row items-center gap-1.5 xl:gap-2.5 min-w-[78px] xl:w-full rounded-xl px-2 xl:px-2.5 py-2 text-center xl:text-left transition-colors", on ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <span className={cx("grid place-items-center size-8 rounded-[9px] bg-surface-2 shrink-0", on ? "text-accent-text" : "text-ink-2")}><Icon size={16} /></span>
                <span className="flex-1 text-[12.5px] xl:text-sm text-ink whitespace-nowrap">{d.name}</span>
                {d.soon ? <span className="hidden xl:inline text-[10px] text-ink-3">Soon</span>
                 : n > 0 ? <span className="absolute xl:static top-1 right-3 min-w-5 h-5 px-1 grid place-items-center rounded-full bg-bad text-white text-[11px] font-semibold">{n}</span> : null}
              </button>
            );
          })}
        </Card>

        {/* Centre */}
        <div className="flex flex-col items-center min-w-0">
          <Core mode={mode} muted={muted} />
          <div className="h-5 text-sm font-medium text-accent-text" aria-live="polite">{STATE[mode]}{mode === "idle" && muted ? " · muted" : ""}</div>
          <h1 className="mt-2 text-[24px] sm:text-[26px] font-medium text-center text-ink leading-tight">{hello}, {me!.name.split(/\s+/)[0]}
            <span className="block mt-1 text-[15px] sm:text-[17px] font-normal text-ink-2">{pending.data?.pending?.overview?.title || " "}</span>
          </h1>
          {pending.error && <div className="mt-3 rounded-xl bg-bad-soft px-4 py-2.5 text-sm text-bad">{(pending.error as Error).message}</div>}
          {pending.data && !pending.data.ai && <div className="mt-3 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-ink text-center">Bunty’s Claude key is not set on this server yet, so he can show departments but cannot answer.</div>}

          <Card className="mt-4 w-full max-w-[640px] p-5">
            <h3 className="font-semibold text-ink">{active?.soon ? `${active.name} · arrives in ${active.soon}` : summary?.title || active?.name || " "}</h3>
            {!active?.soon && <ul className="mt-3 space-y-2.5">
              {(summary?.items || []).map((x, i) => <li key={i} className="flex gap-3 text-[15px] leading-snug text-ink"><span className={cx("mt-[7px] size-2 rounded-full shrink-0", DOT[x.tone])} /><div>{x.text}</div></li>)}
            </ul>}
            {!!summary?.actions?.length && !active?.soon && <div className="mt-4 flex flex-wrap gap-2">{summary.actions.map((a, i) => <Button key={a} size="sm" variant={i ? "secondary" : "primary"} disabled={busy} onClick={() => ask(a)}>{a}</Button>)}</div>}
          </Card>

          {(msgs.length > 0 || cards.length > 0 || err) && (
            <Card className="mt-3 w-full max-w-[640px] p-4">
              <div ref={scroller} className="max-h-[46vh] overflow-y-auto space-y-3 pr-1">
                {msgs.map((m, i) => m.role === "user"
                  ? <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-accent text-on-accent px-3.5 py-2 text-[14.5px] whitespace-pre-wrap">{m.text}</div>
                  : <div key={i} className="max-w-[92%] text-[15px] leading-relaxed text-ink">
                      {!!m.tools?.length && <div className="mb-1 text-xs text-ink-3">{[...new Set(m.tools)].join(" · ")}</div>}
                      {m.text ? <Rich text={m.text} /> : busy && i === msgs.length - 1 && <Loader2 size={15} className="animate-spin text-ink-3" />}
                    </div>)}
                {cards.length > 0 && (
                  <div className="space-y-2">
                    {cards.map((c) => (
                      <div key={c.id} className={cx("rounded-2xl border p-3.5 bg-ai-soft", c.card.danger ? "border-bad" : "border-line")}>
                        <div className="font-semibold text-ink text-sm">{c.card.title}</div>
                        <ul className="mt-1.5 space-y-1 text-[13.5px] text-ink">{c.card.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant={choice[c.id] === true ? "primary" : "secondary"} onClick={() => setChoice((s) => ({ ...s, [c.id]: true }))}>Confirm</Button>
                          <Button size="sm" variant={choice[c.id] === false ? "primary" : "ghost"} onClick={() => setChoice((s) => ({ ...s, [c.id]: false }))}>Cancel</Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-end"><Button variant="primary" disabled={cards.some((c) => choice[c.id] === undefined)} onClick={decide}>Done</Button></div>
                  </div>
                )}
                {err && <div className="text-sm text-bad">{err}</div>}
              </div>
            </Card>
          )}
        </div>

        {/* Right */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 xl:sticky xl:top-20">
          <Card className="px-4 py-3.5">
            <div className="text-xs font-medium text-ink-2 mb-1">Right now</div>
            {kpis.map(([l, v, bad]) => <div key={l} className="flex items-baseline justify-between py-2 border-b border-line last:border-0"><span className="text-[13px] text-ink-2">{l}</span><b className={cx("text-lg font-medium num", bad && v ? "text-bad" : "text-ink")}>{v == null ? "—" : v.toLocaleString("en-US")}</b></div>)}
          </Card>
          <Card className="px-4 py-3.5">
            <div className="text-xs font-medium text-ink-2 mb-1">Today</div>
            {(today.data || []).length === 0 && <div className="py-2 text-[13px] text-ink-3">Nothing on the calendar.</div>}
            {(today.data || []).map((e) => <div key={e.id} className="flex gap-3 py-1.5 text-[13px] leading-snug"><span className="w-10 shrink-0 text-ink-3 num">{fmtTime(e.starts_at)}</span><span className={cx("text-ink min-w-0", e.status === "Completed" && "opacity-55")}>{e.title}</span></div>)}
          </Card>
        </div>
      </div>

      {/* Dock */}
      <div className="fixed z-20 bottom-[76px] lg:bottom-6 left-3 right-3 lg:left-[calc(240px+12px+32px)] lg:right-[calc(12px+32px)] pointer-events-none">
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="pointer-events-auto mx-auto max-w-[720px] flex items-center gap-1.5 rounded-full border border-line bg-surface/90 backdrop-blur-xl shadow-pop p-1.5">
          <button type="button" onClick={toggleHush} title={hushed ? "Reminders hushed for an hour. Press to turn back on" : "Hush reminders for an hour"} aria-pressed={hushed} className={cx("grid place-items-center h-10 sm:px-3 w-10 sm:w-auto gap-1 rounded-full text-[13px] border shrink-0 transition-colors sm:flex", hushed ? "border-gold text-gold bg-gold-soft" : "border-line text-ink-2 bg-surface-2")}>
            {hushed ? <BellOff size={17} /> : <Bell size={17} />}<span className="hidden sm:inline">{hushed ? "Hushed 1h" : "Hush"}</span>
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Bunty anything…" aria-label="Ask Bunty" disabled={!!cards.length} className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-ink placeholder:text-ink-3 px-2" />
          {input.trim() ? (
            <button type="submit" disabled={busy} aria-label="Send" className="grid place-items-center size-11 rounded-full bg-accent text-on-accent shrink-0 disabled:opacity-50"><SendHorizontal size={18} /></button>
          ) : (<>
            <button type="button" onClick={toggleMute} title={muted ? "Bunty stays silent. Press to hear him" : "Keep Bunty silent"} aria-pressed={muted} className={cx("grid place-items-center h-10 sm:px-3 w-10 sm:w-auto gap-1 rounded-full text-[13px] border shrink-0 transition-colors sm:flex", muted ? "border-bad text-bad bg-bad-soft" : "border-line text-ink-2 bg-surface-2")}>
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}<span className="hidden sm:inline">{muted ? "Muted" : "Mute"}</span>
            </button>
            {hasMic && <button type="button" onClick={mic} disabled={busy || !!cards.length} aria-label="Talk" className={cx("grid place-items-center size-11 rounded-full bg-accent text-on-accent shrink-0 disabled:opacity-50", mode === "listening" && "live-dot")}><Mic size={19} /></button>}
          </>)}
        </form>
      </div>
    </div>
  );
}
