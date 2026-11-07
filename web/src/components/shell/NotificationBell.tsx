"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { fmtDateTime } from "@/lib/format";
import { Badge, cx } from "@/components/ui";

type Note = { event_id: string; kind: string; event_type: string; title: string; starts_at: string; lead_id: string | null; lead_name: string | null; is_read: boolean };

const KIND: Record<string, { label: string; tone: "bad" | "warn" | "accent" }> = {
  overdue: { label: "Overdue", tone: "bad" },
  today: { label: "Today", tone: "warn" },
  due_soon: { label: "Soon", tone: "accent" },
};

export function NotificationBell() {
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    enabled: !!me,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("crm_my_notifications");
      if (error) throw error;
      return (data || []) as Note[];
    },
  });
  const unread = data.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openNote(n: Note) {
    setOpen(false);
    if (!n.is_read && me) {
      await db.from("crm_notification_reads").upsert({ user_email: me.email, event_id: n.event_id, kind: n.kind, read_at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    router.push(n.lead_id ? `/leads?open=${n.lead_id}` : "/calendar");
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg text-ink-2 hover:text-ink hover:bg-surface-2" aria-label="Notifications">
        <Bell size={18} />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-bad text-white text-[10px] font-semibold grid place-items-center">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-surface shadow-pop overflow-hidden animate-in">
          <div className="px-4 h-11 flex items-center border-b border-line text-sm font-semibold text-ink">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {data.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-3">You’re all caught up.</div>}
            {data.map((n) => {
              const k = KIND[n.kind] || { label: n.kind, tone: "accent" as const };
              return (
                <button key={n.event_id + n.kind} onClick={() => openNote(n)}
                  className={cx("w-full text-left px-4 py-3 border-b border-line last:border-0 hover:bg-surface-2 flex gap-3", n.is_read && "opacity-60")}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">{n.title || n.event_type}</div>
                    <div className="text-xs text-ink-3 truncate">{n.lead_name ? `${n.lead_name} · ` : ""}{fmtDateTime(n.starts_at)}</div>
                  </div>
                  <Badge tone={k.tone}>{k.label}</Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
